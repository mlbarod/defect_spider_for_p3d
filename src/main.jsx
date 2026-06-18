import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const CONFIG = {
  lineName: 'P3D (D1c)_EQP MAIN',
  selectLine: 'PFB3',
  device: 'D1c',
  eadsRoot: '/appdata/hadoop/code/eads',
  pmCodePath: '/appdata/abnormal_trend/pic/pm_code_info.parquet',
};

const isMainLine = CONFIG.lineName === CONFIG.lineName;
const folderPath = `${CONFIG.eadsRoot}/${CONFIG.selectLine}/${CONFIG.device}`;
const fccFolderPath = `${CONFIG.eadsRoot}/${CONFIG.selectLine}/${CONFIG.device}_fcc`;
const fccStepPath = `${fccFolderPath}/fcc_step`;

const DATA_SOURCES = [
  {
    key: 'spec',
    label: 'Measure SPEC',
    path: `${CONFIG.eadsRoot}/${CONFIG.selectLine}/${CONFIG.device}_measure_spec.parquet`,
    requiredColumns: ['step_seq', 'spec_high'],
  },
  {
    key: 'fail',
    label: '중심치 이상 목록',
    path: `${folderPath}/${isMainLine ? 'main_fail_list.parquet' : 'fail_list.parquet'}`,
    requiredColumns: ['main_seq', 'met_seq', 'eqpid'],
  },
  {
    key: 'std',
    label: '산포 이상 목록',
    path: `${folderPath}/${isMainLine ? 'main_fail_list_std.parquet' : 'fail_list_std.parquet'}`,
    requiredColumns: ['main_seq', 'met_seq', 'eqpid'],
  },
  {
    key: 'met',
    label: 'MET 매핑',
    path: `${CONFIG.eadsRoot}/${CONFIG.selectLine}/met.txt`,
    requiredColumns: ['device', 'main_step', 'met_step', 'step_desc', 'sdwt'],
  },
  {
    key: 'pm',
    label: 'PM 이력',
    path: CONFIG.pmCodePath,
    requiredColumns: ['asset', 'inprg_dt', 'work_type'],
  },
];

const FCC_DATA_SOURCES = [
  {
    key: 'fcc_met',
    label: 'FCC MET 매핑',
    path: `${fccFolderPath}/met_fcc.txt`,
    requiredColumns: ['device', 'main_step', 'met_step', 'step_desc', 'sdwt'],
  },
  {
    key: 'fcc_step_met',
    label: 'FCC 스탭 MET 매핑',
    path: `${fccStepPath}/met_fcc.txt`,
    requiredColumns: ['device', 'main_step', 'met_step', 'step_desc', 'sdwt'],
  },
  {
    key: 'fcc_fail',
    label: 'FCC 중심치 이상 목록',
    path: `${fccStepPath}/fail_list_fcc.parquet`,
    requiredColumns: ['main_seq', 'met_seq', 'eqpch'],
  },
  {
    key: 'fcc_std',
    label: 'FCC 산포 이상 목록',
    path: `${fccStepPath}/fail_list_std.parquet`,
    requiredColumns: ['main_seq', 'met_seq', 'eqpch'],
  },
];

const EMPTY_LOAD_STATE = {
  loading: true,
  error: '',
  rows: [],
  sources: DATA_SOURCES.map((source) => ({ ...source, exists: false, readable: false })),
  diagnostics: {
    version: 'browser-init',
    inputRows: {},
    usedRows: {},
    outputRows: 0,
    warnings: [],
  },
};

const EMPTY_FCC_LOAD_STATE = {
  loading: true,
  error: '',
  apiPath: '/api/fcc-summary',
  rows: [],
  sources: FCC_DATA_SOURCES.map((source) => ({ ...source, exists: false, readable: false })),
  diagnostics: {
    version: 'browser-init',
    inputRows: {},
    usedRows: {},
    outputRows: 0,
    warnings: [],
  },
};

async function fetchJson(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  let payload;

  if (!contentType.includes('application/json')) {
    const preview = body.slice(0, 80).replace(/\s+/g, ' ');
    throw Object.assign(new Error(`/api 응답이 JSON이 아닙니다. 정적 서버나 Vite preview가 HTML을 반환했습니다: ${preview}`), { requestUrl: url });
  }

  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw Object.assign(new Error(`/api JSON 파싱 실패: ${error.message}`), { requestUrl: url });
  }

  if (!response.ok || payload.ok === false) {
    throw Object.assign(new Error(payload.error || `${url} 요청 실패`), { payload, requestUrl: url });
  }

  return payload;
}

function hideFilePaths(value) {
  return String(value ?? '')
    .replace(/(?:\/[^\s,)\]}]+)+/g, (match) => (match.startsWith('/api') ? match : '[숨김]'))
    .replace(/[A-Za-z]:\\[^\s,)\]}]+/g, '[숨김]');
}

function getSdwtTokens(value) {
  if (!value || typeof value !== 'string') return [];

  return value
    .replaceAll('\u00a0', ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildSdwtOptions(rows) {
  const seen = new Set();
  const options = ['ALL'];

  rows.forEach((row) => {
    getSdwtTokens(row.sdwt).forEach((token) => {
      if (!seen.has(token)) {
        seen.add(token);
        options.push(token);
      }
    });
  });

  return options;
}

function getMetStepDisplay(metStep) {
  const match = String(metStep).match(/^(\d{6})_(.+)$/);
  if (!match) return { metStepNo: metStep, metItem: '' };

  return { metStepNo: match[1], metItem: match[2] };
}

function stripPercentPrefix(value) {
  const text = String(value ?? '').trim();
  return text.includes('%') ? text.split('%').pop() : text;
}

function stripFccPrefix(value) {
  const text = String(value ?? '').trim();
  return text.toLowerCase().startsWith('fcc_') ? text.slice(4) : text;
}

function getChartMetStep(row) {
  if (row?.dataKind === 'fcc') return stripFccPrefix(stripPercentPrefix(row.metStepPath ?? row.metStep));

  let rawMetStep = stripPercentPrefix(row.metStepPath ?? row.metStep);
  while (rawMetStep.endsWith('_main_main')) rawMetStep = rawMetStep.replace(/_main_main$/, '_main');
  if (isMainLine && rawMetStep.endsWith('_main')) return rawMetStep;

  const { metStepNo, metItem } = getMetStepDisplay(rawMetStep);
  const metStep = metItem ? `${metStepNo}_${metItem}` : metStepNo;

  return isMainLine ? `${metStep}_main` : metStep;
}

function getChartHeading(row) {
  if (!row) return CONFIG.lineName;
  const { metStepNo, metItem } = getMetStepDisplay(row.metStep);
  return [row.stepDesc || 'step_desc 확인 필요', metStepNo, metItem].filter(Boolean).join(' / ');
}

function filterRowsBySdwt(rows, selectedSdwt) {
  if (selectedSdwt === 'ALL') return rows;

  return rows.filter((row) => getSdwtTokens(row.sdwt).includes(selectedSdwt));
}

function groupRowsByMainStep(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const current = grouped.get(row.mainStep) ?? {
      mainStep: row.mainStep,
      stepSeq: row.stepSeq ?? row.mainStep,
      stepDesc: row.stepDesc,
      sdwt: row.sdwt,
      metSteps: [],
      centerCount: 0,
      stdCount: 0,
      eqpCount: 0,
    };

    if (row.stepSeq && !current.stepSeq) current.stepSeq = row.stepSeq;
    if (row.stepDesc && !current.stepDesc) current.stepDesc = row.stepDesc;
    if (row.sdwt && !current.sdwt) current.sdwt = row.sdwt;
    current.metSteps.push(row);
    current.centerCount += row.centerCount ?? 0;
    current.stdCount += row.stdCount ?? 0;
    current.eqpCount += row.eqpIds?.length ?? 0;
    grouped.set(row.mainStep, current);
  });

  return Array.from(grouped.values()).sort((a, b) => a.mainStep.localeCompare(b.mainStep));
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SourceStatusBanner({ loading, error, sources, diagnostics, latestDate }) {
  const missingSources = sources.filter((source) => !source.exists || !source.readable);
  const warningCount = diagnostics?.warnings?.length ?? 0;
  const title = loading
    ? '원본 파일 읽는 중'
    : error
      ? '원본 파일 읽기 실패'
      : latestDate
        ? `${latestDate} 데이터 기준 이상감지`
        : '이상감지 기준일 확인 중';

  return (
    <section className={`sourceBanner ${error ? 'error' : ''}`}>
      <div>
        <p className="eyebrow">File Loader</p>
        <h2>{title}</h2>
      </div>
      <div className="sourceBannerText">
        {error ? <strong>{hideFilePaths(error)}</strong> : <span>웹 UI가 Vite API를 통해 파일 상태를 확인합니다.</span>}
        <span>
          loader {diagnostics?.version ?? 'unknown'} / 입력 {Object.values(diagnostics?.inputRows ?? {}).reduce((sum, value) => sum + Number(value || 0), 0).toLocaleString()}행 / 표시 {Number(diagnostics?.outputRows ?? 0).toLocaleString()}건
        </span>
        {missingSources.length > 0 && (
          <span>
            미확인 파일 {missingSources.length}개: {missingSources.map((source) => source.label).join(', ')}
          </span>
        )}
        {warningCount > 0 && <span>경고 {warningCount}개: {diagnostics.warnings.slice(0, 2).map(hideFilePaths).join(' / ')}</span>}
      </div>
    </section>
  );
}

function SdwtSelector({ options, selectedSdwt, onSelect, disabled }) {
  return (
    <div className="sdwtButtons" aria-label="SDWT 선택">
      {options.map((option) => (
        <button
          key={option}
          className={selectedSdwt === option ? 'active' : ''}
          disabled={disabled && option !== 'ALL'}
          onClick={() => onSelect(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function SourceReferenceList({ apiPath, sources = [] }) {
  if (!apiPath && sources.length === 0) return null;

  return (
    <div className="sourceReferenceList">
      {apiPath && (
        <div>
          <strong>API</strong>
          <code>{apiPath}</code>
        </div>
      )}
      {sources.map((source) => (
        <div key={source.key ?? source.path}>
          <strong>
            {source.label}
            <span className={source.exists && source.readable ? 'readOk' : 'readFail'}>
              {source.exists && source.readable ? 'readable' : source.exists ? 'not readable' : 'missing'}
            </span>
          </strong>
          <code>{source.path}</code>
        </div>
      ))}
    </div>
  );
}

function MainStepTree({ groups, selectedMetStepKey, onSelectMetStep, loading, error, diagnostics }) {
  const [openSteps, setOpenSteps] = useState(() => new Set());

  useEffect(() => {
    if (groups[0]?.mainStep) setOpenSteps(new Set([groups[0].mainStep]));
    else setOpenSteps(new Set());
  }, [groups]);

  const toggleMainStep = (mainStep) => {
    setOpenSteps((current) => {
      const next = new Set(current);

      if (next.has(mainStep)) next.delete(mainStep);
      else next.add(mainStep);

      return next;
    });
  };

  return (
    <aside className="sidePanel primaryStepPanel" aria-label="메인 스텝 선택">
      <div className="sideHeader">
        <div>
          <p className="eyebrow">Main Step</p>
          <h2>대상스탭</h2>
        </div>
        <span className="countBadge">{groups.length}</span>
      </div>

      {groups.length === 0 ? (
        <div className="emptyPanel">
          <strong>표시할 main_step이 없습니다.</strong>
          <span>
            {loading
              ? '원본 파일을 읽고 있습니다.'
              : hideFilePaths(error) ||
                `파일 입력 ${Object.values(diagnostics?.inputRows ?? {}).reduce((sum, value) => sum + Number(value || 0), 0).toLocaleString()}행 중 화면에 표시할 대상이 0건입니다.`}
          </span>
          {diagnostics?.warnings?.slice(0, 3).map((warning) => (
            <span key={warning}>{hideFilePaths(warning)}</span>
          ))}
        </div>
      ) : (
        <div className="mainStepList">
          {groups.map((group) => {
            const isOpen = openSteps.has(group.mainStep);
            const hasSelectedMetStep = group.metSteps.some((metStep) => metStep.key === selectedMetStepKey);

            return (
              <section key={group.mainStep} className={`mainStepGroup ${hasSelectedMetStep ? 'selected' : ''}`}>
                <button
                  className="mainStepToggle"
                  onClick={() => toggleMainStep(group.mainStep)}
                  aria-expanded={isOpen}
                  aria-controls={`metsteps-${group.mainStep}`}
                >
                  <span className={`chevron ${isOpen ? 'open' : ''}`} aria-hidden="true">
                    ▸
                  </span>
                  <span className="mainStepTitle">
                    <span className="stepNameRow">
                      <span className="stepName">{group.stepDesc || 'step_desc 확인 필요'}</span>
                      <span className="stepSeqBadge">{group.stepSeq || group.mainStep}</span>
                    </span>
                  </span>
                  <span className="mainScore">{group.metSteps.length} met</span>
                </button>
                {isOpen && (
                  <div className="subStepButtons" id={`metsteps-${group.mainStep}`}>
                    {group.metSteps.map((row) => {
                      const { metStepNo, metItem } = getMetStepDisplay(row.metStep);

                      return (
                        <button
                          key={row.key}
                          className={`subStepButton ${selectedMetStepKey === row.key ? 'active' : ''}`}
                          onClick={() => onSelectMetStep(row)}
                        >
                          <span>
                            {metStepNo}
                            {metItem ? ` / ${metItem}` : ''}
                          </span>
                          <strong>{row.eqpIds?.length ?? 0} eqp</strong>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function AdditionalAnomalyStepTree({ groups, selectedMetStepKey, onSelectMetStep, loading, error, diagnostics, sources, apiPath }) {
  const [openSteps, setOpenSteps] = useState(() => new Set());

  useEffect(() => {
    if (groups[0]?.mainStep) setOpenSteps(new Set([groups[0].mainStep]));
    else setOpenSteps(new Set());
  }, [groups]);

  const toggleMainStep = (mainStep) => {
    setOpenSteps((current) => {
      const next = new Set(current);

      if (next.has(mainStep)) next.delete(mainStep);
      else next.add(mainStep);

      return next;
    });
  };

  return (
    <aside className="sidePanel secondaryStepPanel" aria-label="추가 이상감지 스텝 선택">
      <div className="sideHeader">
        <div>
          <p className="eyebrow">Additional Detection</p>
          <h2>FCC지수 연관 이상감지</h2>
        </div>
        <span className="countBadge">{groups.length}</span>
      </div>

      {groups.length === 0 ? (
        <div className="emptyPanel">
          <strong>표시할 main_step이 없습니다.</strong>
          <span>
            {loading
              ? '원본 파일을 읽고 있습니다.'
              : hideFilePaths(error) ||
                `파일 입력 ${Object.values(diagnostics?.inputRows ?? {}).reduce((sum, value) => sum + Number(value || 0), 0).toLocaleString()}행 중 화면에 표시할 대상이 0건입니다.`}
          </span>
          {diagnostics?.warnings?.slice(0, 3).map((warning) => (
            <span key={warning}>{hideFilePaths(warning)}</span>
          ))}
          <SourceReferenceList apiPath={apiPath} sources={sources} />
        </div>
      ) : (
        <div className="mainStepList secondaryStepList">
          {groups.map((group) => {
            const isOpen = openSteps.has(group.mainStep);
            const hasSelectedMetStep = group.metSteps.some((metStep) => metStep.key === selectedMetStepKey);

            return (
              <section key={group.mainStep} className={`mainStepGroup secondaryStepGroup ${hasSelectedMetStep ? 'selected' : ''}`}>
                <button
                  className="mainStepToggle"
                  onClick={() => toggleMainStep(group.mainStep)}
                  aria-expanded={isOpen}
                  aria-controls={`additional-metsteps-${group.mainStep}`}
                >
                  <span className={`chevron ${isOpen ? 'open' : ''}`} aria-hidden="true">
                    ▸
                  </span>
                  <span className="mainStepTitle">
                    <span className="stepNameRow">
                      <span className="stepName">{group.stepDesc || 'step_desc 확인 필요'}</span>
                      <span className="stepSeqBadge">{group.stepSeq || group.mainStep}</span>
                    </span>
                  </span>
                  <span className="mainScore">{group.metSteps.length} met</span>
                </button>
                {isOpen && (
                  <div className="subStepButtons" id={`additional-metsteps-${group.mainStep}`}>
                    {group.metSteps.map((row) => {
                      const { metStepNo, metItem } = getMetStepDisplay(row.metStep);
                      const centerCount = row.centerCount ?? 0;
                      const stdCount = row.stdCount ?? 0;
                      const anomalyText = centerCount + stdCount > 0 ? `중 ${centerCount} / 산 ${stdCount}` : '없음';

                      return (
                        <button
                          key={row.key}
                          className={`subStepButton secondaryStepButton ${selectedMetStepKey === row.key ? 'active' : ''}`}
                          onClick={() => onSelectMetStep(row)}
                        >
                          <span>
                            {metStepNo}
                            {metItem ? ` / ${metItem}` : ''}
                          </span>
                          <strong>{anomalyText}</strong>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTime(value, point) {
  const epoch = Number(point?.tkout_time_ms ?? point?.inprg_dt_ms);
  if (Number.isFinite(epoch)) return epoch;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function formatShortDate(value, points = []) {
  if (!value) return '';
  const nearest = points.reduce((current, point) => {
    if (!point.tkout_time_text || point.x === null) return current;
    if (!current) return point;
    return Math.abs(point.x - value) < Math.abs(current.x - value) ? point : current;
  }, null);
  if (nearest?.tkout_time_text) {
    const text = String(nearest.tkout_time_text);
    return text.includes('T') ? text.replace('T', ' ').slice(5, 16) : text.slice(5, 16);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getPointTooltipRows(point) {
  return [
    ['lot_wf', point.lot_wf],
    ['tkout_time', point.tkout_time_text || point.tkout_time],
    ['eqp_ch', point.eqp_ch],
    ['step_seq', point.step_seq],
    ['fab_value', point.fab_value],
  ].map(([label, value]) => [label, value === null || value === undefined || value === '' ? '-' : String(value)]);
}

function normalizeTextValue(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function isNgDecision(value) {
  return normalizeTextValue(value).toUpperCase().replace(/[^A-Z0-9]/g, '') === 'NG';
}

function getNgDecisionValue(point) {
  if (point?.anomaly_type === 'std') return point.std_result ?? point.final_decision;
  return point?.final_decision;
}

function getPointIdentity(point) {
  const lotId = normalizeTextValue(point?.lot_id ?? point?.lot_wf);
  const waferId = normalizeTextValue(point?.wafer_id);

  return lotId && waferId ? `${lotId}::${waferId}` : '';
}

function buildNgIdentitySet(points) {
  const identities = new Set();

  points.forEach((point) => {
    if (!isNgDecision(getNgDecisionValue(point))) return;
    const identity = getPointIdentity(point);
    if (identity) identities.add(identity);
  });

  return identities;
}

function pointMatchesNg(point, ngIdentitySet = null) {
  if (isNgDecision(getNgDecisionValue(point))) return true;
  const identity = getPointIdentity(point);
  return Boolean(identity && ngIdentitySet?.has(identity));
}

const STEP_LEGEND_COLORS = [
  { swatch: 'hsl(268 75% 58%)', point: 'hsla(268, 75%, 58%, 0.16)' },
  { swatch: 'hsl(204 94% 45%)', point: 'hsla(204, 94%, 45%, 0.16)' },
  { swatch: 'hsl(152 57% 40%)', point: 'hsla(152, 57%, 40%, 0.16)' },
  { swatch: 'hsl(35 92% 56%)', point: 'hsla(35, 92%, 56%, 0.16)' },
  { swatch: 'hsl(350 89% 60%)', point: 'hsla(350, 89%, 60%, 0.16)' },
  { swatch: 'hsl(240 55% 58%)', point: 'hsla(240, 55%, 58%, 0.16)' },
];

function getLegendKey(type, value) {
  return `${type}:${String(value)}`;
}

function getStepPrefix(point) {
  const text = String(point?.step_seq ?? '').trim();
  return text ? text.slice(0, 2) : '-';
}

function getEquipmentId(point, fallback = '') {
  const value = point?.eqp_id ?? point?.eqpid ?? point?.eqp_ch ?? fallback;
  const text = String(value ?? '').trim();
  return text || '-';
}

function eqpListIncludes(eqpIds, eqpId) {
  const target = String(eqpId ?? '').trim();
  return Array.isArray(eqpIds) && eqpIds.some((value) => String(value ?? '').trim() === target);
}

function prepareCanvas(canvas, width, height) {
  if (!canvas) return null;

  const ratio = window.devicePixelRatio || 1;
  const nextWidth = Math.round(width * ratio);
  const nextHeight = Math.round(height * ratio);
  if (canvas.width !== nextWidth) canvas.width = nextWidth;
  if (canvas.height !== nextHeight) canvas.height = nextHeight;

  const context = canvas.getContext('2d');
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

function svgNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function buildCirclePath(points, radius) {
  if (points.length === 0) return '';

  const diameter = svgNumber(radius * 2);
  const r = svgNumber(radius);

  return points
    .map((point) => {
      const x = svgNumber(point.sx);
      const y = svgNumber(point.sy);
      return `M${svgNumber(x + radius)},${y}a${r},${r} 0 1,0 -${diameter},0a${r},${r} 0 1,0 ${diameter},0`;
    })
    .join('');
}

function ChartLegend({ stepItems, equipmentItems, hiddenKeys, onToggle }) {
  if (stepItems.length === 0 && equipmentItems.length === 0) return null;

  const renderItems = (items) =>
    items.map((item) => {
      const isHidden = hiddenKeys.has(item.key);

      return (
        <button key={item.key} className={`legendItem ${isHidden ? 'isHidden' : ''}`} type="button" onClick={() => onToggle(item.key)} title={item.label}>
          <span className="legendSwatch" style={{ background: item.color }} aria-hidden="true" />
          <span className="legendLabel">{item.label}</span>
          <span className="legendCount">{item.count.toLocaleString()}</span>
        </button>
      );
    });

  return (
    <aside className="chartLegend" aria-label="chart legend">
      {stepItems.length > 0 && (
        <div className="legendGroup">
          <strong>STEP</strong>
          {renderItems(stepItems)}
        </div>
      )}
      {equipmentItems.length > 0 && (
        <div className="legendGroup">
          <strong>EQP</strong>
          {renderItems(equipmentItems)}
        </div>
      )}
    </aside>
  );
}

const ScatterChart = React.memo(function ScatterChart({ allPoints, failPoints, stdPoints, pmEvents, eqpId, domains, anomalyType }) {
  const [viewDomain, setViewDomain] = useState(null);
  const [dragRange, setDragRange] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [hiddenLegendKeys, setHiddenLegendKeys] = useState(() => new Set());
  const canvasRef = useRef(null);
  const plotRef = useRef(null);
  const width = 720;
  const height = 238;
  const padding = { left: 56, right: 18, top: 22, bottom: 42 };
  const backgroundPointRadius = 1.25;
  const anomalyPointRadius = 3.7;
  const [legendHeight, setLegendHeight] = useState(height);
  const clipOverflow = 7;
  const clipId = `plot-${String(`${eqpId}-${anomalyType ?? 'all'}`).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const axisPoints = useMemo(
    () => allPoints.map((point) => ({ ...point, x: toTime(point.tkout_time, point), y: toNumber(point.fab_value) })).filter((point) => point.x !== null),
    [allPoints],
  );
  const allScatterPoints = useMemo(() => axisPoints.filter((point) => point.y !== null), [axisPoints]);
  const centerScatterPoints = useMemo(
    () =>
      failPoints
        .map((point) => ({ ...point, anomaly_type: point.anomaly_type || 'center', x: toTime(point.tkout_time, point), y: toNumber(point.fab_value) }))
        .filter((point) => point.x !== null && point.y !== null),
    [failPoints],
  );
  const stdScatterPoints = useMemo(
    () =>
      stdPoints
        .map((point) => ({ ...point, anomaly_type: point.anomaly_type || 'std', x: toTime(point.tkout_time, point), y: toNumber(point.fab_value) }))
        .filter((point) => point.x !== null && point.y !== null),
    [stdPoints],
  );
  const scatterPoints = useMemo(() => [...centerScatterPoints, ...stdScatterPoints], [centerScatterPoints, stdScatterPoints]);
  const ngIdentitySet = useMemo(
    () => buildNgIdentitySet([...failPoints, ...stdPoints]),
    [failPoints, stdPoints],
  );
  const hasPoints = allScatterPoints.length > 0 || scatterPoints.length > 0;
  const stepLegendItems = useMemo(() => {
    const counts = new Map();

    allScatterPoints.forEach((point) => {
      const label = getStepPrefix(point);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });

    return Array.from(counts.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, count], index) => {
        const color = STEP_LEGEND_COLORS[index % STEP_LEGEND_COLORS.length];

        return {
          key: getLegendKey('step', label),
          label,
          count,
          color: color.swatch,
          pointColor: color.point,
        };
      });
  }, [allScatterPoints]);
  const stepPointColorByPrefix = useMemo(() => new Map(stepLegendItems.map((item) => [item.label, item.pointColor])), [stepLegendItems]);
  const equipmentLegendItems = useMemo(() => {
    const counts = new Map();
    const groupedEqpId = String(eqpId ?? '').trim();
    const addPoint = (point, fallback = '') => {
      const label = getEquipmentId(point, fallback);
      const current = counts.get(label) ?? { label, count: 0, grouped: label === groupedEqpId };
      current.count += 1;
      current.grouped = current.grouped || label === groupedEqpId;
      counts.set(label, current);
    };

    allScatterPoints.forEach((point) => addPoint(point));
    scatterPoints.forEach((point) => addPoint(point, groupedEqpId));

    return Array.from(counts.values())
      .sort((left, right) => Number(right.grouped) - Number(left.grouped) || left.label.localeCompare(right.label))
      .map((item) => ({
        key: getLegendKey('eqp', item.label),
        label: item.label,
        count: item.count,
        color: item.grouped ? 'hsl(0 72% 51%)' : 'hsl(240 4% 64%)',
      }));
  }, [allScatterPoints, scatterPoints, eqpId]);
  const visibleAllScatterPoints = useMemo(
    () =>
      allScatterPoints.filter(
        (point) => !hiddenLegendKeys.has(getLegendKey('step', getStepPrefix(point))) && !hiddenLegendKeys.has(getLegendKey('eqp', getEquipmentId(point))),
      ),
    [allScatterPoints, hiddenLegendKeys],
  );
  const visibleScatterPoints = useMemo(
    () =>
      scatterPoints.filter(
        (point) => !hiddenLegendKeys.has(getLegendKey('step', getStepPrefix(point))) && !hiddenLegendKeys.has(getLegendKey('eqp', getEquipmentId(point, eqpId))),
      ),
    [scatterPoints, hiddenLegendKeys, eqpId],
  );
  const toggleLegendKey = (key) => {
    setHiddenLegendKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const fallbackXValues = (axisPoints.length > 0 ? axisPoints : scatterPoints).map((point) => point.x);
  const fallbackYValues = (allScatterPoints.length > 0 ? allScatterPoints : scatterPoints).map((point) => point.y);
  const resolveRange = (range, fallbackValues) => {
    const minValue = toNumber(range?.min);
    const maxValue = toNumber(range?.max);
    if (minValue !== null && maxValue !== null) return { min: minValue, max: maxValue };
    if (fallbackValues.length > 0) return { min: Math.min(...fallbackValues), max: Math.max(...fallbackValues) };
    return { min: 0, max: 1 };
  };
  const getYDomain = (range, shouldPad = true) => {
    if (range.max === range.min) {
      return {
        minY: range.min - 1,
        maxY: range.max + 1,
      };
    }
    if (!shouldPad) {
      return {
        minY: range.min,
        maxY: range.max,
      };
    }
    const span = Math.max(0, range.max - range.min);
    const yPad = Math.max(1, span * 0.12);
    return {
      minY: range.min - yPad,
      maxY: range.max + yPad,
    };
  };
  const xRange = resolveRange(domains?.x, fallbackXValues);
  const yFullRange = resolveRange(domains?.yFull, fallbackYValues);
  const yInitialRange = resolveRange(domains?.yInitial, fallbackYValues);
  const normalizedXRange = xRange.max === xRange.min ? { min: xRange.min, max: xRange.max + 1 } : xRange;
  const fullDomain = {
    minX: normalizedXRange.min,
    maxX: normalizedXRange.max,
    ...getYDomain(yFullRange),
  };
  const initialDomain = {
    minX: normalizedXRange.min,
    maxX: normalizedXRange.max,
    ...getYDomain(yInitialRange, false),
  };

  useEffect(() => {
    setViewDomain(null);
    setDragRange(null);
    setTooltip(null);
    setHiddenLegendKeys(new Set());
  }, [allPoints, anomalyType, failPoints, stdPoints, eqpId]);

  useEffect(() => {
    const element = plotRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const updateLegendHeight = () => {
      const nextHeight = Math.max(height, Math.round(element.getBoundingClientRect().height));
      setLegendHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
    };
    const observer = new ResizeObserver(updateLegendHeight);

    updateLegendHeight();
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const domain = viewDomain ?? initialDomain;
  const { minX: viewMinX, maxX: viewMaxX, minY: viewMinY, maxY: viewMaxY } = domain;
  const xScale = (value) => padding.left + ((value - viewMinX) / Math.max(1, viewMaxX - viewMinX)) * plotWidth;
  const yScale = (value) => padding.top + plotHeight - ((value - viewMinY) / Math.max(1, viewMaxY - viewMinY)) * plotHeight;
  const xInvert = (value) => viewMinX + ((value - padding.left) / plotWidth) * Math.max(1, viewMaxX - viewMinX);
  const yInvert = (value) => viewMaxY - ((value - padding.top) / plotHeight) * Math.max(1, viewMaxY - viewMinY);
  const clampX = (value) => Math.min(width - padding.right, Math.max(padding.left, value));
  const clampY = (value) => Math.min(height - padding.bottom, Math.max(padding.top, value));
  const isVisible = (point) => point.x >= viewMinX && point.x <= viewMaxX && point.y >= viewMinY && point.y <= viewMaxY;
  const xTicks = [viewMinX, viewMinX + (viewMaxX - viewMinX) / 2, viewMaxX];
  const yTicks = [viewMinY, viewMinY + (viewMaxY - viewMinY) / 2, viewMaxY];
  const visibleAllScreenPoints = useMemo(
    () =>
      visibleAllScatterPoints.filter(isVisible).map((point) => {
        const stepPrefix = getStepPrefix(point);

        return {
          point,
          sx: xScale(point.x),
          sy: yScale(point.y),
          color: stepPointColorByPrefix.get(stepPrefix) ?? STEP_LEGEND_COLORS[0].point,
        };
      }),
    [visibleAllScatterPoints, stepPointColorByPrefix, viewMinX, viewMaxX, viewMinY, viewMaxY, plotWidth, plotHeight],
  );
  const visibleScatterScreenPoints = useMemo(
    () =>
      visibleScatterPoints.filter(isVisible).map((point) => ({
        point,
        sx: xScale(point.x),
        sy: yScale(point.y),
        isNg: isNgPoint(point, ngIdentitySet),
        isStd: point.anomaly_type === 'std',
      })),
    [visibleScatterPoints, ngIdentitySet, viewMinX, viewMaxX, viewMinY, viewMaxY, plotWidth, plotHeight],
  );
  const scatterPathItems = useMemo(() => {
    const groups = new Map();

    visibleScatterScreenPoints.forEach((point) => {
      const className = `${point.isNg ? 'failPoint' : 'okPoint'} ${point.isStd ? 'stdScatterPoint' : 'centerScatterPoint'}`;
      const group = groups.get(className);
      if (group) group.push(point);
      else groups.set(className, [point]);
    });

    return Array.from(groups.entries()).map(([className, points]) => ({
      className,
      borderD: buildCirclePath(points, anomalyPointRadius + (className.includes('stdScatterPoint') ? 0.7 : 0.5)),
      d: buildCirclePath(points, anomalyPointRadius),
    }));
  }, [visibleScatterScreenPoints, anomalyPointRadius]);
  const buildHoverIndex = (screenPoints, cellSize = 12) => {
    const buckets = new Map();

    screenPoints.forEach((item) => {
      const key = `${Math.floor(item.sx / cellSize)}:${Math.floor(item.sy / cellSize)}`;
      const bucket = buckets.get(key);

      if (bucket) bucket.push(item);
      else buckets.set(key, [item]);
    });

    return { buckets, cellSize };
  };
  const allHoverIndex = useMemo(() => buildHoverIndex(visibleAllScreenPoints), [visibleAllScreenPoints]);
  const scatterHoverIndex = useMemo(() => buildHoverIndex(visibleScatterScreenPoints), [visibleScatterScreenPoints]);
  const selection = dragRange
    ? {
        x: Math.min(dragRange.startX, dragRange.endX),
        y: Math.min(dragRange.startY, dragRange.endY),
        width: Math.abs(dragRange.endX - dragRange.startX),
        height: Math.abs(dragRange.endY - dragRange.startY),
      }
    : null;
  const clampDomain = (next) => {
    const fullX = Math.max(1, fullDomain.maxX - fullDomain.minX);
    const fullY = Math.max(1, fullDomain.maxY - fullDomain.minY);
    const spanX = Math.min(fullX, Math.max(1, next.maxX - next.minX));
    const spanY = Math.min(fullY, Math.max(1, next.maxY - next.minY));
    let minDomainX = next.minX;
    let minDomainY = next.minY;

    if (minDomainX < fullDomain.minX) minDomainX = fullDomain.minX;
    if (minDomainX + spanX > fullDomain.maxX) minDomainX = fullDomain.maxX - spanX;
    if (minDomainY < fullDomain.minY) minDomainY = fullDomain.minY;
    if (minDomainY + spanY > fullDomain.maxY) minDomainY = fullDomain.maxY - spanY;

    return {
      minX: minDomainX,
      maxX: minDomainX + spanX,
      minY: minDomainY,
      maxY: minDomainY + spanY,
    };
  };
  const getSvgPoint = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clampX(((event.clientX - rect.left) / rect.width) * width),
      y: clampY(((event.clientY - rect.top) / rect.height) * height),
    };
  };
  const getTooltipPosition = (event) => {
    const container = event.currentTarget.ownerSVGElement?.closest?.('.chartCanvas') ?? event.currentTarget.closest?.('.chartCanvas');
    const rect = container?.getBoundingClientRect();
    if (!rect) return { x: 12, y: 12 };
    const maxLeft = Math.max(8, rect.width - 196);
    return {
      x: Math.min(maxLeft, Math.max(8, event.clientX - rect.left + 12)),
      y: Math.max(8, event.clientY - rect.top + 12),
    };
  };
  const showTooltip = (event, point) => {
    setTooltip({
      rows: getPointTooltipRows(point),
      ...getTooltipPosition(event),
    });
  };
  const findIndexedPoint = (index, position, threshold) => {
    const thresholdSquared = threshold * threshold;
    const cellX = Math.floor(position.x / index.cellSize);
    const cellY = Math.floor(position.y / index.cellSize);
    let nearest = null;
    let nearestDistance = thresholdSquared;

    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        const bucket = index.buckets.get(`${cellX + xOffset}:${cellY + yOffset}`);
        if (!bucket) continue;

        bucket.forEach((item) => {
          const distance = (item.sx - position.x) ** 2 + (item.sy - position.y) ** 2;
          if (distance <= nearestDistance) {
            nearest = item.point;
            nearestDistance = distance;
          }
        });
      }
    }

    return nearest;
  };
  const handleMouseDown = (event) => {
    const point = getSvgPoint(event);
    setTooltip(null);
    setDragRange({ startX: point.x, startY: point.y, endX: point.x, endY: point.y });
  };
  const handleMouseMove = (event) => {
    const point = getSvgPoint(event);
    if (dragRange) {
      setDragRange((current) => current && { ...current, endX: point.x, endY: point.y });
      return;
    }

    const scatterPoint = findIndexedPoint(scatterHoverIndex, point, anomalyPointRadius + 3);
    const canvasPoint = scatterPoint ?? findIndexedPoint(allHoverIndex, point, 6);
    if (canvasPoint) showTooltip(event, canvasPoint);
    else setTooltip(null);
  };
  const handleMouseUp = (event) => {
    if (!dragRange) return;
    const endPoint = getSvgPoint(event);
    const range = { ...dragRange, endX: endPoint.x, endY: endPoint.y };
    const selectedWidth = Math.abs(range.endX - range.startX);
    const selectedHeight = Math.abs(range.endY - range.startY);
    const isZoomInDrag = range.endX > range.startX && range.endY > range.startY;
    const isZoomOutDrag = range.endX < range.startX && range.endY < range.startY;

    if (selectedWidth >= 8 && selectedHeight >= 8 && (isZoomInDrag || isZoomOutDrag)) {
      const selected = {
        minX: xInvert(Math.min(range.startX, range.endX)),
        maxX: xInvert(Math.max(range.startX, range.endX)),
        minY: yInvert(Math.max(range.startY, range.endY)),
        maxY: yInvert(Math.min(range.startY, range.endY)),
      };

      if (isZoomInDrag) {
        setViewDomain(clampDomain(selected));
      } else if (!viewDomain) {
        setViewDomain(fullDomain);
      } else {
        const currentSpanX = viewMaxX - viewMinX;
        const currentSpanY = viewMaxY - viewMinY;
        const factor = Math.min(6, Math.max(currentSpanX / Math.max(1, selected.maxX - selected.minX), currentSpanY / Math.max(1, selected.maxY - selected.minY)));
        const centerX = (selected.minX + selected.maxX) / 2;
        const centerY = (selected.minY + selected.maxY) / 2;
        setViewDomain(
          clampDomain({
            minX: centerX - (currentSpanX * factor) / 2,
            maxX: centerX + (currentSpanX * factor) / 2,
            minY: centerY - (currentSpanY * factor) / 2,
            maxY: centerY + (currentSpanY * factor) / 2,
          }),
        );
      }
    }

    setDragRange(null);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = prepareCanvas(canvas, width, height);
    if (!context) return;
    context.save();
    context.beginPath();
    context.rect(padding.left - clipOverflow, padding.top - clipOverflow, plotWidth + clipOverflow * 2, plotHeight + clipOverflow * 2);
    context.clip();
    const colorGroups = new Map();
    visibleAllScreenPoints.forEach((point) => {
      const group = colorGroups.get(point.color);
      if (group) group.push(point);
      else colorGroups.set(point.color, [point]);
    });

    colorGroups.forEach((points, color) => {
      context.fillStyle = color;
      context.beginPath();
      points.forEach((point) => {
        context.moveTo(point.sx + backgroundPointRadius, point.sy);
        context.arc(point.sx, point.sy, backgroundPointRadius, 0, Math.PI * 2);
      });
      context.fill();
    });
    context.restore();
  }, [visibleAllScreenPoints, plotWidth, plotHeight]);

  if (!hasPoints) {
    return <div className="emptyMiniState">차트 parquet에서 tkout_time/fab_value 데이터를 찾지 못했습니다.</div>;
  }

  return (
    <div className="chartCanvas" style={{ '--chart-legend-height': `${legendHeight}px` }}>
      <div className="chartPlot" ref={plotRef}>
        <canvas ref={canvasRef} className="scatterCanvas" aria-hidden="true" />
        <svg
          className="scatterChart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="eqp 시계열 차트"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            setDragRange(null);
            setTooltip(null);
          }}
          onDoubleClick={() => {
            setViewDomain(null);
            setDragRange(null);
          }}
        >
          <clipPath id={clipId}>
            <rect x={padding.left - clipOverflow} y={padding.top - clipOverflow} width={plotWidth + clipOverflow * 2} height={plotHeight + clipOverflow * 2} />
          </clipPath>
          {yTicks.map((tick) => (
            <g key={tick}>
              <line className="gridLine" x1={padding.left} x2={width - padding.right} y1={yScale(tick)} y2={yScale(tick)} />
              <text className="axisText" x={padding.left - 8} y={yScale(tick) + 4} textAnchor="end">
                {Math.round(tick).toLocaleString()}
              </text>
            </g>
          ))}
          {xTicks.map((tick, index) => (
            <text key={tick} className="axisText" x={xScale(tick)} y={height - 17} textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}>
              {formatShortDate(tick, axisPoints)}
            </text>
          ))}
          <line className="axisLine" x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} />
          <line className="axisLine" x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} />
          <g clipPath={`url(#${clipId})`}>
            {pmEvents
              .map((event) => ({ ...event, x: toTime(event.inprg_dt, event) }))
              .filter((event) => event.x !== null && event.x >= viewMinX && event.x <= viewMaxX)
              .map((event, index) => (
                <g key={`${event.inprg_dt}-${index}`}>
                  <line className="pmLine" x1={xScale(event.x)} x2={xScale(event.x)} y1={padding.top} y2={height - padding.bottom} />
                  <text className="pmText" x={xScale(event.x) + 4} y={padding.top + 12}>
                    {event.work_type}
                  </text>
                </g>
              ))}
            {scatterPathItems.map((item) => (
              <path key={`${item.className}-border`} className="pointBorderLayer" d={item.borderD} pointerEvents="none" />
            ))}
            {scatterPathItems.map((item) => (
              <path key={item.className} className={`${item.className} pointFillLayer`} d={item.d} pointerEvents="none" />
            ))}
          </g>
        </svg>
        {selection && selection.width > 1 && selection.height > 1 && (
          <div
            className="zoomSelectionOverlay"
            style={{
              left: `${(selection.x / width) * 100}%`,
              top: `${(selection.y / height) * 100}%`,
              width: `${(selection.width / width) * 100}%`,
              height: `${(selection.height / height) * 100}%`,
            }}
          />
        )}
      </div>
      <ChartLegend stepItems={stepLegendItems} equipmentItems={equipmentLegendItems} hiddenKeys={hiddenLegendKeys} onToggle={toggleLegendKey} />
      {tooltip && (
        <div className="tooltipPanel" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.rows.map(([label, value]) => (
            <span key={label}>
              <strong>{label}</strong> {value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

const NG_TABLE_COLUMNS = ['wafer_id', 'tkout_time', 'step_seq', 'eqp_id', 'lot_id', 'process_id', 'item_id', 'fab_value'];
const ANOMALY_META = {
  center: { label: '중심치 이상', tagClass: 'center' },
  std: { label: '산포이상', tagClass: 'std' },
};

function isNgPoint(point, ngIdentitySet = null) {
  return pointMatchesNg(point, ngIdentitySet);
}

function isDrawablePoint(point) {
  return toTime(point?.tkout_time, point) !== null && toNumber(point?.fab_value) !== null;
}

function formatTableValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number' && Number.isFinite(value)) return value.toLocaleString();
  return String(value);
}

function getNgTableValue(point, column, row, eqpId) {
  if (column === 'tkout_time') return point.tkout_time_text || point.tkout_time;
  if (column === 'eqp_id') return point.eqp_id ?? point.eqpid ?? point.eqp_ch ?? eqpId;
  if (column === 'lot_id') return point.lot_id ?? point.lot_wf;
  if (column === 'item_id') return point.item_id ?? getMetStepDisplay(row.metStep).metItem;
  return point[column];
}

function NgPointTable({ points, row, eqpId }) {
  return (
    <div className="ngTableShell">
      <table className="ngPointTable">
        <thead>
          <tr>
            {NG_TABLE_COLUMNS.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.length > 0 ? (
            points.map((point, index) => (
              <tr key={`${point.anomaly_type ?? 'ng'}-${point.tkout_time_ms ?? point.tkout_time}-${index}`}>
                {NG_TABLE_COLUMNS.map((column) => (
                  <td key={column}>{formatTableValue(getNgTableValue(point, column, row, eqpId))}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={NG_TABLE_COLUMNS.length}>NG 데이터가 없습니다.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function getTypedDomains(domains, anomalyType) {
  const typedDomain = domains?.[anomalyType];
  if (!typedDomain) return domains;

  return {
    ...domains,
    yFull: typedDomain.yFull ?? domains?.yFull,
    yInitial: typedDomain.yInitial ?? typedDomain.yFull ?? domains?.yInitial,
  };
}

function ChartTag({ anomalyType }) {
  const meta = ANOMALY_META[anomalyType] ?? ANOMALY_META.center;
  return (
    <div className="chartTags" aria-label="이상 유형">
      <span className={`anomalyTag ${meta.tagClass}`}>{meta.label}</span>
    </div>
  );
}

function AnomalyChartCard({ row, eqpId, chartData, anomalyType, points }) {
  const [isTableOpen, setIsTableOpen] = useState(false);
  const meta = ANOMALY_META[anomalyType] ?? ANOMALY_META.center;
  const ngIdentitySet = useMemo(() => buildNgIdentitySet(points), [points]);
  const ngTablePoints = useMemo(() => {
    const seen = new Set();

    return points
      .filter((point) => isNgPoint(point, ngIdentitySet) && isDrawablePoint(point))
      .filter((point) => {
        const key = [
          getPointIdentity(point),
          point.tkout_time_ms ?? point.tkout_time ?? '',
          point.fab_value ?? '',
          getEquipmentId(point, eqpId),
        ].join('|');

        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [points, ngIdentitySet, eqpId]);
  const tableId = `ng-table-${String(`${eqpId}-${anomalyType}`).replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <div className="chartShell">
      <div className="chartTitle">
        <div className="chartTitleText">
          <strong>{eqpId}</strong>
          <span>
            {getChartHeading(row)} / {meta.label}
          </span>
        </div>
        <ChartTag anomalyType={anomalyType} />
      </div>
      <ScatterChart
        allPoints={chartData.allPoints ?? []}
        failPoints={anomalyType === 'center' ? points : []}
        stdPoints={anomalyType === 'std' ? points : []}
        pmEvents={chartData.pmEvents ?? []}
        domains={getTypedDomains(chartData.domains ?? null, anomalyType)}
        eqpId={eqpId}
        anomalyType={anomalyType}
      />
      <button className="ngTableToggle" type="button" onClick={() => setIsTableOpen((current) => !current)} aria-expanded={isTableOpen} aria-controls={tableId}>
        <span className={`chevron ${isTableOpen ? 'open' : ''}`} aria-hidden="true">
          ▸
        </span>
        <span>이상감지 Wafer List 보기</span>
        <strong>{ngTablePoints.length.toLocaleString()} rows</strong>
      </button>
      {isTableOpen && (
        <div id={tableId}>
          <NgPointTable points={ngTablePoints} row={row} eqpId={eqpId} />
        </div>
      )}
    </div>
  );
}

function EquipmentChart({ row, eqpId, onLatestDate, chartEndpoint = '/api/chart' }) {
  const [chartState, setChartState] = useState({ loading: true, error: '', data: null });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      mainStep: row.mainStepPath ?? row.mainStep,
      chartMetStep: getChartMetStep(row),
      eqpId,
      t: String(Date.now()),
    });

    setChartState({ loading: true, error: '', data: null });
    fetchJson(`${chartEndpoint}?${params.toString()}`, { signal: controller.signal })
      .then((payload) => {
        setChartState({ loading: false, error: '', data: payload });
        if (payload.latestDate) onLatestDate?.(payload.latestDate);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setChartState({ loading: false, error: error.message, data: error.payload ?? null });
      });

    return () => controller.abort();
  }, [chartEndpoint, eqpId, onLatestDate, row]);

  const failPoints = chartState.data?.failPoints ?? [];
  const stdPoints = chartState.data?.stdPoints ?? [];
  const shouldDrawCenter = eqpListIncludes(row.centerEqpIds, eqpId);
  const shouldDrawStd = eqpListIncludes(row.stdEqpIds, eqpId);
  const chartConfigs = [
    { anomalyType: 'center', points: shouldDrawCenter ? failPoints : [] },
    { anomalyType: 'std', points: shouldDrawStd ? stdPoints : [] },
  ].filter((config) => config.points.length > 0);

  if (chartState.loading || chartState.error || chartConfigs.length === 0) {
    return (
      <div className="chartShell">
        <div className="chartTitle">
          <div className="chartTitleText">
            <strong>{eqpId}</strong>
            <span>
              {getChartHeading(row)}
            </span>
          </div>
          <span className="chartStatusText">{chartState.loading ? 'loading' : chartState.error ? 'read failed' : 'no anomaly data'}</span>
        </div>
        <div className="emptyChartBody">
          <p>
            {chartState.loading
              ? '차트 parquet 파일을 읽고 있습니다.'
              : chartState.error
                ? hideFilePaths(chartState.error)
                : '선택한 eqp_id에서 중심치/산포 이상 데이터를 찾지 못했습니다.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {chartConfigs.map((config) => (
        <AnomalyChartCard key={`${eqpId}-${config.anomalyType}`} row={row} eqpId={eqpId} chartData={chartState.data} {...config} />
      ))}
    </>
  );
}

function EmptyChartState({ selectedRow }) {
  return (
    <div className="chartShell emptyChart">
      <div className="chartTitle">
        <div className="chartTitleText">
          <strong>eqp별 Chart</strong>
          <span>{selectedRow ? getChartHeading(selectedRow) : 'step 선택 필요'}</span>
        </div>
        <span>no mock data</span>
      </div>
      <div className="emptyChartBody">
        <p>
          {selectedRow
            ? '선택한 met_step에 연결된 eqp_id 목록이 확인되면 eqp별 차트를 그립니다.'
            : '좌측에서 main_step을 펼친 뒤 met_step을 선택하면 eqp별 차트 영역이 표시됩니다.'}
        </p>
      </div>
    </div>
  );
}

function App() {
  const [loadState, setLoadState] = useState(EMPTY_LOAD_STATE);
  const [fccLoadState, setFccLoadState] = useState(EMPTY_FCC_LOAD_STATE);
  const rows = loadState.rows;
  const fccRows = fccLoadState.rows;
  const sdwtOptions = useMemo(() => buildSdwtOptions([...rows, ...fccRows]), [rows, fccRows]);
  const [selectedSdwt, setSelectedSdwt] = useState('ALL');
  const filteredRows = useMemo(() => filterRowsBySdwt(rows, selectedSdwt), [rows, selectedSdwt]);
  const filteredFccRows = useMemo(() => filterRowsBySdwt(fccRows, selectedSdwt), [fccRows, selectedSdwt]);
  const mainStepGroups = useMemo(() => groupRowsByMainStep(filteredRows), [filteredRows]);
  const fccStepGroups = useMemo(() => groupRowsByMainStep(filteredFccRows), [filteredFccRows]);
  const [selectedMetStep, setSelectedMetStep] = useState(null);
  const [selectedAdditionalMetStep, setSelectedAdditionalMetStep] = useState(null);
  const [activeChartSource, setActiveChartSource] = useState('main');
  const [chartLatestDate, setChartLatestDate] = useState('');

  useEffect(() => {
    fetchJson(`/api/summary?t=${Date.now()}`)
      .then((payload) => {
        setLoadState({
          loading: false,
          error: '',
          rows: payload.rows ?? [],
          sources: payload.sources ?? EMPTY_LOAD_STATE.sources,
          diagnostics: payload.diagnostics ?? EMPTY_LOAD_STATE.diagnostics,
        });
      })
      .catch((error) => {
        setLoadState({
          loading: false,
          error: error.message,
          rows: [],
          sources: error.payload?.sources ?? EMPTY_LOAD_STATE.sources,
          diagnostics: error.payload?.diagnostics ?? EMPTY_LOAD_STATE.diagnostics,
        });
      });
  }, []);

  useEffect(() => {
    fetchJson(`/api/fcc-summary?t=${Date.now()}`)
      .then((payload) => {
        setFccLoadState({
          loading: false,
          error: '',
          apiPath: '/api/fcc-summary',
          rows: payload.rows ?? [],
          sources: payload.sources ?? EMPTY_FCC_LOAD_STATE.sources,
          diagnostics: payload.diagnostics ?? EMPTY_FCC_LOAD_STATE.diagnostics,
        });
      })
      .catch((error) => {
        setFccLoadState({
          loading: false,
          error: error.message,
          apiPath: error.requestUrl ?? '/api/fcc-summary',
          rows: [],
          sources: error.payload?.sources ?? EMPTY_FCC_LOAD_STATE.sources,
          diagnostics: error.payload?.diagnostics ?? EMPTY_FCC_LOAD_STATE.diagnostics,
        });
      });
  }, []);

  useEffect(() => {
    const firstMetStep = mainStepGroups[0]?.metSteps[0] ?? null;
    setSelectedMetStep((current) => {
      if (current && mainStepGroups.some((group) => group.metSteps.some((row) => row.key === current.key))) return current;
      return firstMetStep;
    });
  }, [mainStepGroups]);

  useEffect(() => {
    const firstFccMetStep = fccStepGroups[0]?.metSteps[0] ?? null;
    setSelectedAdditionalMetStep((current) => {
      if (current && fccStepGroups.some((group) => group.metSteps.some((row) => row.key === current.key))) return current;
      return firstFccMetStep;
    });
  }, [fccStepGroups]);

  useEffect(() => {
    setChartLatestDate('');
  }, [activeChartSource, activeChartSource === 'fcc' ? selectedAdditionalMetStep?.key : selectedMetStep?.key]);

  useEffect(() => {
    if (activeChartSource === 'fcc' && !selectedAdditionalMetStep && selectedMetStep) setActiveChartSource('main');
    if (activeChartSource === 'main' && !selectedMetStep && selectedAdditionalMetStep) setActiveChartSource('fcc');
  }, [activeChartSource, selectedAdditionalMetStep, selectedMetStep]);

  const activeSelectedRow = activeChartSource === 'fcc' ? selectedAdditionalMetStep : selectedMetStep;
  const activeLoadState = activeChartSource === 'fcc' ? fccLoadState : loadState;
  const activeChartEndpoint = activeChartSource === 'fcc' ? '/api/fcc-chart' : '/api/chart';
  const activeChartEyebrow = activeChartSource === 'fcc' ? 'FCC Equipment Charts' : 'Equipment Charts';
  const selectedEqpIds = activeSelectedRow?.eqpIds ?? [];
  const metStepCount = mainStepGroups.reduce((sum, group) => sum + group.metSteps.length, 0);
  const eqpCount = filteredRows.reduce((sum, row) => sum + (row.eqpIds?.length ?? 0), 0);
  const fccMetStepCount = fccStepGroups.reduce((sum, group) => sum + group.metSteps.length, 0);
  const fccEqpCount = filteredFccRows.reduce((sum, row) => sum + (row.eqpIds?.length ?? 0), 0);

  return (
    <main className="app">
      <header className="topBar">
        <div>
          <p className="eyebrow">P3D Defect Spider</p>
          <h1>Defect SPIDER</h1>
        </div>
        <div className="summaryPills">
          <span>감지 라인 {CONFIG.lineName}</span>
          <span>선택 라인 {CONFIG.selectLine}</span>
          <span>Device {CONFIG.device}</span>
          <span>SDWT {selectedSdwt}</span>
          <span>{activeChartSource === 'fcc' ? 'FCC 차트' : 'Main 차트'}</span>
        </div>
      </header>

      <SourceStatusBanner
        loading={activeLoadState.loading}
        error={activeLoadState.error}
        sources={activeLoadState.sources}
        diagnostics={activeLoadState.diagnostics}
        latestDate={chartLatestDate}
      />

      <div className="topMetrics">
        <Metric label="메인 스탭" value={mainStepGroups.length.toLocaleString()} />
        <Metric label="MET 스탭" value={metStepCount.toLocaleString()} />
        <Metric label="감지 댓수" value={eqpCount.toLocaleString()} />
        <Metric label="FCC 스탭 / 댓수" value={`${fccMetStepCount.toLocaleString()} / ${fccEqpCount.toLocaleString()}`} />
      </div>

      <section className="workspace">
        <div className="leftRail">
          <SdwtSelector options={sdwtOptions} selectedSdwt={selectedSdwt} onSelect={setSelectedSdwt} disabled={rows.length === 0 && fccRows.length === 0} />
          <MainStepTree
            groups={mainStepGroups}
            selectedMetStepKey={selectedMetStep?.key}
            onSelectMetStep={(row) => {
              setSelectedMetStep(row);
              setActiveChartSource('main');
            }}
            loading={loadState.loading}
            error={loadState.error}
            diagnostics={loadState.diagnostics}
          />
          <AdditionalAnomalyStepTree
            groups={fccStepGroups}
            selectedMetStepKey={selectedAdditionalMetStep?.key}
            onSelectMetStep={(row) => {
              setSelectedAdditionalMetStep(row);
              setActiveChartSource('fcc');
            }}
            loading={fccLoadState.loading}
            error={fccLoadState.error}
            diagnostics={fccLoadState.diagnostics}
            sources={fccLoadState.sources}
            apiPath={fccLoadState.apiPath}
          />
        </div>

        <section className="detailPanel">
          <div className="detailHeader">
            <div>
              <p className="eyebrow">{activeChartEyebrow}</p>
              <h2>{getChartHeading(activeSelectedRow)}</h2>
            </div>
            <div className="statusChip">{activeLoadState.error ? '파일 읽기 실패' : activeLoadState.loading ? '파일 읽는 중' : '실제 파일 기반'}</div>
          </div>

          <div className="chartGrid">
            {activeSelectedRow && selectedEqpIds.length > 0 ? (
              selectedEqpIds.map((eqpId) => (
                <EquipmentChart key={`${activeChartSource}-${eqpId}`} row={activeSelectedRow} eqpId={eqpId} onLatestDate={setChartLatestDate} chartEndpoint={activeChartEndpoint} />
              ))
            ) : (
              <EmptyChartState selectedRow={activeSelectedRow} />
            )}
          </div>
        </section>
      </section>
      <button className="scrollTopButton" type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
        TOP
      </button>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

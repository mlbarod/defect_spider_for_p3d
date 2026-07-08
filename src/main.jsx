import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const CONFIG = {
  lineName: 'P3D (D1c)_EQP MAIN',
  selectLine: 'PFB3',
  device: 'D1c',
  eadsRoot: '/appdata/hadoop/code/eads',
  pmCodePath: '/appdata/abnormal_trend/pic/change_code_info.parquet',
};

const DEFECT_MAP_CONFIG_ENDPOINT = '/api/defect-map-config';
let defectMapConfigRequest = null;

const isMainLine = CONFIG.lineName === CONFIG.lineName;
const folderPath = `${CONFIG.eadsRoot}/${CONFIG.selectLine}/${CONFIG.device}`;
const fccFolderPath = `${CONFIG.eadsRoot}/${CONFIG.selectLine}/${CONFIG.device}_fcc`;
const fccStepPath = `${fccFolderPath}/fcc_step`;
const fccTimefitPath = `${fccFolderPath}/fcc_timefit`;
const HISTORY_LINE_NAMES = {
  main: 'P3D (MAIN)',
  fcc: 'P3D (FCC)',
};

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
    requiredColumns: ['main_seq', 'met_seq', 'eqpid/eqpch'],
  },
  {
    key: 'std',
    label: '산포 이상 목록',
    path: `${folderPath}/${isMainLine ? 'main_fail_list_std.parquet' : 'fail_list_std.parquet'}`,
    requiredColumns: ['main_seq', 'met_seq', 'eqpid/eqpch'],
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
    requiredColumns: ['asset 또는 eqp_ch/eqpch', 'inprg_dt', 'work_type', 'description', 'url'],
  },
];

const FCC_DATA_SOURCES = [
  {
    key: 'fcc_step_met',
    label: 'FCC 스탭 MET 매핑',
    path: `${fccStepPath}/met_fcc.txt`,
    requiredColumns: ['device', 'main_step', 'met_step', 'draw_category', 'step_desc', 'sdwt'],
  },
  {
    key: 'fcc_fail',
    label: 'FCC 중심치 이상 목록',
    path: `${fccStepPath}/fail_list.parquet`,
    requiredColumns: ['main_seq', 'met_seq', 'eqpid/eqpch'],
  },
  {
    key: 'fcc_extra_met',
    label: 'FCC 추가 MET 매핑',
    path: `${fccFolderPath}/met_fcc.txt`,
    requiredColumns: ['device', 'main_step', 'met_step', 'step_desc', 'sdwt'],
  },
  {
    key: 'fcc_extra_fail',
    label: 'FCC 추가 중심치 이상 목록',
    path: `${fccFolderPath}/fail_list.parquet`,
    requiredColumns: ['main_seq', 'met_seq', 'eqpid/eqpch'],
  },
  {
    key: 'fcc_extra_std',
    label: 'FCC 추가 산포 이상 목록',
    path: `${fccFolderPath}/fail_list_std.parquet`,
    requiredColumns: ['main_seq', 'met_seq', 'eqpid/eqpch'],
  },
  {
    key: 'fcc_timefit_fail_list',
    label: 'FCC 이상시점 추가 이상 목록',
    path: `${fccTimefitPath}/fail_fccdate_list.parquet`,
    requiredColumns: ['step_seq', 'eqp_ch', 'tkout_time', 'main_step'],
  },
];

const CHAMBER_DATA_SOURCES = [
  {
    key: 'line_mapping',
    label: '개별 챔버 이상감지 라인 매핑파일',
    path: `${CONFIG.eadsRoot}/line_mapping.txt`,
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
  metrics: {
    extraMetMainStepCount: 0,
    extraMetStepCount: 0,
    centerEqpCount: 0,
    timefitMainStepCount: 0,
    timefitEqpCount: 0,
    timefitAnomalyCount: 0,
  },
  sources: FCC_DATA_SOURCES.map((source) => ({ ...source, exists: false, readable: false })),
  diagnostics: {
    version: 'browser-init',
    inputRows: {},
    usedRows: {},
    outputRows: 0,
    warnings: [],
  },
};

const EMPTY_CHAMBER_LINES_STATE = {
  loading: true,
  error: '',
  apiPath: '/api/chamber-lines',
  rows: [],
  sources: CHAMBER_DATA_SOURCES.map((source) => ({ ...source, exists: false, readable: false })),
  diagnostics: {
    version: 'browser-init',
    resolvedPaths: {},
    inputRows: {},
    outputRows: 0,
  },
};

const EMPTY_CHAMBER_LOAD_STATE = {
  loading: false,
  error: '',
  apiPath: '/api/chamber-summary',
  rows: [],
  sources: [],
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

function normalizeDefectMapTemplate(payload) {
  const template = payload?.urlTemplate ?? payload?.template ?? payload?.url ?? '';
  return String(template ?? '').trim();
}

function loadDefectMapConfig() {
  if (!defectMapConfigRequest) {
    defectMapConfigRequest = fetchJson(`${DEFECT_MAP_CONFIG_ENDPOINT}?t=${Date.now()}`)
      .then((payload) => normalizeDefectMapTemplate(payload))
      .catch((error) => {
        defectMapConfigRequest = null;
        throw error;
      });
  }

  return defectMapConfigRequest;
}

function useDefectMapUrlTemplate() {
  const [state, setState] = useState({ loading: true, error: '', template: '' });

  useEffect(() => {
    let isMounted = true;

    loadDefectMapConfig()
      .then((template) => {
        if (isMounted) setState({ loading: false, error: '', template });
      })
      .catch((error) => {
        if (isMounted) setState({ loading: false, error: error.message, template: '' });
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return state;
}

function getHistorySelectStep(row) {
  return String(row?.metStep ?? row?.metStepPath ?? '').trim().split('_')[0].trim();
}

function getClickHistoryRequest(lineName, row) {
  const normalizedLineName = String(lineName ?? '').trim();
  const selectStep = getHistorySelectStep(row);

  if (!normalizedLineName || !selectStep) return null;

  const params = new URLSearchParams({
    lineName: normalizedLineName,
    selectStep,
    t: String(Date.now()),
  });

  return {
    lineName: normalizedLineName,
    selectStep,
    url: `/api/click-history?${params.toString()}`,
  };
}

async function uploadClickHistory(request) {
  return fetchJson(request.url);
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
  if (row?.dataKind === 'chamber') return stripPercentPrefix(row.metStepPath ?? row.metStep);

  let rawMetStep = stripPercentPrefix(row.metStepPath ?? row.metStep);
  while (rawMetStep.endsWith('_main_main')) rawMetStep = rawMetStep.replace(/_main_main$/, '_main');
  if (isMainLine && rawMetStep.endsWith('_main')) return rawMetStep;

  const { metStepNo, metItem } = getMetStepDisplay(rawMetStep);
  const metStep = metItem ? `${metStepNo}_${metItem}` : metStepNo;

  return isMainLine ? `${metStep}_main` : metStep;
}

function getChartHeading(row, chartData = null) {
  if (!row) return CONFIG.lineName;
  const { metStepNo, metItem } = getMetStepDisplay(row.metStep);
  const itemDisplay = row.dataKind === 'fcc' ? String(chartData?.itemDesc ?? '').trim() || metItem : metItem;
  return [row.stepDesc || 'step_desc 확인 필요', metStepNo, itemDisplay].filter(Boolean).join(' / ');
}

function filterRowsBySdwt(rows, selectedSdwt) {
  if (selectedSdwt === 'ALL') return rows;

  return rows.filter((row) => getSdwtTokens(row.sdwt).includes(selectedSdwt));
}

function compareCenterAnomalyFirst(a, b) {
  const aPriority = Number(a.sourcePriority ?? ((a.centerCount ?? 0) > 0 ? 1 : 2));
  const bPriority = Number(b.sourcePriority ?? ((b.centerCount ?? 0) > 0 ? 1 : 2));
  if (aPriority !== bPriority) return aPriority - bPriority;
  const aCenterPriority = (a.centerCount ?? 0) > 0 ? 0 : 1;
  const bCenterPriority = (b.centerCount ?? 0) > 0 ? 0 : 1;
  if (aCenterPriority !== bCenterPriority) return aCenterPriority - bCenterPriority;
  return String(a.metStep ?? '').localeCompare(String(b.metStep ?? ''));
}

function groupRowsByMainStep(rows, { prioritizeCenter = false } = {}) {
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
      sourcePriority: row.sourcePriority ?? 2,
    };

    if (row.stepSeq && !current.stepSeq) current.stepSeq = row.stepSeq;
    if (row.stepDesc && !current.stepDesc) current.stepDesc = row.stepDesc;
    if (row.sdwt && !current.sdwt) current.sdwt = row.sdwt;
    current.sourcePriority = Math.min(current.sourcePriority ?? 2, row.sourcePriority ?? 2);
    current.metSteps.push(row);
    current.centerCount += row.centerCount ?? 0;
    current.stdCount += row.stdCount ?? 0;
    current.eqpCount += row.eqpIds?.length ?? 0;
    grouped.set(row.mainStep, current);
  });

  if (prioritizeCenter) {
    grouped.forEach((group) => {
      group.metSteps.sort(compareCenterAnomalyFirst);
    });
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (prioritizeCenter) {
      const aPriority = Number(a.sourcePriority ?? ((a.centerCount ?? 0) > 0 ? 1 : 2));
      const bPriority = Number(b.sourcePriority ?? ((b.centerCount ?? 0) > 0 ? 1 : 2));
      if (aPriority !== bPriority) return aPriority - bPriority;
      const aCenterPriority = (a.centerCount ?? 0) > 0 ? 0 : 1;
      const bCenterPriority = (b.centerCount ?? 0) > 0 ? 0 : 1;
      if (aCenterPriority !== bCenterPriority) return aCenterPriority - bCenterPriority;
    }

    return a.mainStep.localeCompare(b.mainStep);
  });
}

function getOpenMainSteps(groups) {
  return new Set(groups.map((group) => group.mainStep).filter(Boolean));
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
  const useGridLayout = options.length > 3;

  return (
    <div className={`sdwtButtons ${useGridLayout ? 'gridLayout' : ''}`} aria-label="SDWT 선택">
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
    setOpenSteps(getOpenMainSteps(groups));
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
                      const displayMetItem = getMetStepButtonItem(row, metItem);

                      return (
                        <button
                          key={row.key}
                          className={`subStepButton ${selectedMetStepKey === row.key ? 'active' : ''}`}
                          onClick={() => onSelectMetStep(row)}
                        >
                          <span>
                            {metStepNo}
                            {displayMetItem ? ` / ${displayMetItem}` : ''}
                          </span>
                          <strong>
                            {row.eqpIds?.length ?? 0} eqp
                            {row.timefitCount ? ` / ${Number(row.timefitCount).toLocaleString()} fccdate` : ''}
                          </strong>
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
    setOpenSteps(getOpenMainSteps(groups));
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
          <strong>이상감지된 STEP이 없습니다.</strong>
          <span>
            {loading
              ? '원본 파일을 읽고 있습니다.'
              : hideFilePaths(error) ||
                `파일 입력 ${Object.values(diagnostics?.inputRows ?? {}).reduce((sum, value) => sum + Number(value || 0), 0).toLocaleString()}행 중 화면에 표시할 대상이 0건입니다.`}
          </span>
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
                      const displayMetItem = String(row.metItem2 ?? '').trim() || metItem;

                      return (
                        <button
                          key={row.key}
                          className={`subStepButton secondaryStepButton ${selectedMetStepKey === row.key ? 'active' : ''}`}
                          onClick={() => onSelectMetStep(row)}
                        >
                          <span>
                            {metStepNo}
                            {displayMetItem ? ` / ${displayMetItem}` : ''}
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

function hasPmAssetSeparator(asset) {
  const text = String(asset ?? '').trim();
  if (!text) return true;
  return text.includes('-') || text.includes('_');
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
    ['eqp_ch', point.eqp_ch ?? point.eqpch],
    ['step_seq', point.step_seq],
    ['met_ppid', point.ppid],
    ['ppid', point.ppid_right],
    ['fab_value', point.fab_value],
  ].map(([label, value]) => [label, value === null || value === undefined || value === '' ? '-' : String(value)]);
}

function getTooltipPointKey(point) {
  return [
    point?.anomaly_type ?? '',
    point?.tkout_time_ms ?? point?.tkout_time ?? '',
    point?.fab_value ?? '',
    point?.wafer_id ?? '',
    point?.lot_id ?? point?.lot_wf ?? '',
    point?.eqp_id ?? point?.eqpid ?? point?.eqp_ch ?? point?.eqpch ?? '',
  ].join('|');
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

function hasNgDecision(point) {
  if (point?.management_highlight) return true;
  if (point?.anomaly_type === 'std') {
    return isNgDecision(point.std_result) || isNgDecision(point.final_decision);
  }
  return isNgDecision(point?.final_decision);
}

function getPointIdentity(point) {
  const lotId = normalizeTextValue(point?.lot_id ?? point?.lot_wf);
  const waferId = normalizeTextValue(point?.wafer_id);

  return lotId && waferId ? `${lotId}::${waferId}` : '';
}

function buildNgIdentitySet(points) {
  const identities = new Set();

  points.forEach((point) => {
    if (!hasNgDecision(point)) return;
    const identity = getPointIdentity(point);
    if (identity) identities.add(identity);
  });

  return identities;
}

function pointMatchesNg(point, ngIdentitySet = null) {
  if (hasNgDecision(point)) return true;
  const identity = getPointIdentity(point);
  return Boolean(identity && ngIdentitySet?.has(identity));
}

const STEP_LEGEND_COLORS = [
  { swatch: 'hsl(268 75% 52%)', point: 'hsla(268, 75%, 52%, 0.24)' },
  { swatch: 'hsl(204 94% 40%)', point: 'hsla(204, 94%, 40%, 0.24)' },
  { swatch: 'hsl(152 57% 34%)', point: 'hsla(152, 57%, 34%, 0.24)' },
  { swatch: 'hsl(35 92% 48%)', point: 'hsla(35, 92%, 48%, 0.24)' },
  { swatch: 'hsl(316 69% 44%)', point: 'hsla(316, 69%, 44%, 0.24)' },
  { swatch: 'hsl(240 55% 50%)', point: 'hsla(240, 55%, 50%, 0.24)' },
];

const TARGET_Y_TICK_COUNT = 7;

function getNiceYAxisInterval(minY, maxY, targetTickCount = TARGET_Y_TICK_COUNT) {
  const span = Math.max(1, maxY - minY);
  const rawInterval = span / Math.max(1, targetTickCount - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawInterval));
  const normalized = rawInterval / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;

  return niceNormalized * magnitude;
}

function roundUpToTickInterval(value, interval) {
  if (!Number.isFinite(value)) return interval;
  return Math.max(interval, Math.ceil(value / interval) * interval);
}

function getIntervalPrecision(interval) {
  if (!Number.isFinite(interval) || Number.isInteger(interval)) return 0;
  const [mantissa, exponentText] = interval.toExponential().split('e');
  const mantissaDecimals = (mantissa.split('.')[1] ?? '').length;
  const exponent = Number(exponentText);

  return Math.min(8, Math.max(0, exponent < 0 ? -exponent + mantissaDecimals : mantissaDecimals - exponent));
}

function buildYAxisTicks(minY, maxY) {
  const interval = getNiceYAxisInterval(minY, maxY);
  const precision = getIntervalPrecision(interval);
  const start = Math.ceil(minY / interval) * interval;
  const end = Math.floor(maxY / interval) * interval;
  const ticks = [];

  for (let index = 0; index < 100; index += 1) {
    const tick = Number((start + interval * index).toFixed(precision));
    if (tick > end + interval / 1000) break;
    ticks.push(Object.is(tick, -0) ? 0 : tick);
  }

  return ticks.length > 0 ? ticks : [0];
}

function formatAxisTick(value) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function getLegendKey(type, value) {
  return `${type}:${String(value)}`;
}

function getStepPrefix(point) {
  const text = String(point?.step_seq ?? '').trim();
  return text ? text.slice(0, 2) : '-';
}

function getEquipmentId(point, fallback = '') {
  const value = point?.eqp_id ?? point?.eqpid ?? point?.eqp_ch ?? point?.eqpch ?? fallback;
  const text = String(value ?? '').trim();
  return text || '-';
}

function getEquipmentLegendLabel(point, fallback = '') {
  const value = point?.eqp_ch ?? point?.eqpch ?? fallback;
  const text = String(value ?? '').trim();
  return text || '-';
}

function pointMatchesEquipment(point, eqpId) {
  const target = String(eqpId ?? '').trim();
  if (!target) return false;

  return [point?.eqp_id, point?.eqpid, point?.eqp_ch, point?.eqpch].some((value) => String(value ?? '').trim() === target);
}

function eqpListIncludes(eqpIds, eqpId) {
  const target = String(eqpId ?? '').trim();
  return Array.isArray(eqpIds) && eqpIds.some((value) => String(value ?? '').trim() === target);
}

function getPrioritizedEqpIds(row) {
  const result = [];
  const seen = new Set();

  [row?.centerEqpIds, row?.stdEqpIds, row?.eqpIds].forEach((values) => {
    if (!Array.isArray(values)) return;

    values.forEach((value) => {
      const eqpId = String(value ?? '').trim();
      if (!eqpId || seen.has(eqpId)) return;
      seen.add(eqpId);
      result.push(eqpId);
    });
  });

  return result;
}

function getPrioritizedFccEqpIds(row) {
  const result = [];
  const seen = new Set();

  [row?.centerEqpIds, row?.timefitEqpIds, row?.eqpIds].forEach((values) => {
    if (!Array.isArray(values)) return;

    values.forEach((value) => {
      const eqpId = String(value ?? '').trim();
      if (!eqpId || seen.has(eqpId)) return;
      seen.add(eqpId);
      result.push(eqpId);
    });
  });

  return result;
}

function isFccSingleRow(row) {
  return row?.anomalySource === 'fcc_single' || String(row?.drawCategory ?? '').trim().toLowerCase() === 'single' || row?.suppressExtraCharts === true;
}

function getMetStepButtonItem(row, fallback = '') {
  if (isFccSingleRow(row)) return String(row?.metItem2 ?? '').trim() || fallback;
  return fallback;
}

function getEquipmentChartEndpoint(row, chartEndpoint) {
  if (row?.dataKind === 'fcc') return '/api/fcc-chart';
  return chartEndpoint;
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

const ScatterChart = React.memo(function ScatterChart({ allPoints, failPoints, stdPoints, pmEvents, eqpId, domains, anomalyType, highlightRange = null }) {
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
    const addPoint = (point) => {
      const label = getEquipmentLegendLabel(point);
      const isGrouped = pointMatchesEquipment(point, groupedEqpId);
      const current = counts.get(label) ?? { label, count: 0, grouped: isGrouped };
      current.count += 1;
      current.grouped = current.grouped || isGrouped;
      counts.set(label, current);
    };

    allScatterPoints.forEach((point) => addPoint(point));
    scatterPoints.forEach((point) => addPoint(point));

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
        (point) => !hiddenLegendKeys.has(getLegendKey('step', getStepPrefix(point))) && !hiddenLegendKeys.has(getLegendKey('eqp', getEquipmentLegendLabel(point))),
      ),
    [allScatterPoints, hiddenLegendKeys],
  );
  const visibleScatterPoints = useMemo(
    () =>
      scatterPoints.filter(
        (point) => !hiddenLegendKeys.has(getLegendKey('step', getStepPrefix(point))) && !hiddenLegendKeys.has(getLegendKey('eqp', getEquipmentLegendLabel(point))),
      ),
    [scatterPoints, hiddenLegendKeys],
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
    const minY = 0;
    const maxRangeValue = Math.max(minY + 1, range.max);
    const roundMaxY = (value) => roundUpToTickInterval(value, getNiceYAxisInterval(minY, value));

    if (maxRangeValue === minY) return { minY, maxY: getNiceYAxisInterval(minY, minY + 1) };
    if (!shouldPad) {
      return {
        minY,
        maxY: roundMaxY(maxRangeValue),
      };
    }
    const span = Math.max(0, maxRangeValue - minY);
    const yPad = Math.max(1, span * 0.12);
    return {
      minY,
      maxY: roundMaxY(maxRangeValue + yPad),
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
  const xTicks = useMemo(() => [viewMinX, viewMinX + (viewMaxX - viewMinX) / 2, viewMaxX], [viewMinX, viewMaxX]);
  const yTicks = useMemo(() => buildYAxisTicks(viewMinY, viewMaxY), [viewMinY, viewMaxY]);
  const timeHighlight = useMemo(() => {
    const min = toNumber(highlightRange?.min);
    const max = toNumber(highlightRange?.max);
    if (min === null || max === null || max < viewMinX || min > viewMaxX) return null;

    const startX = xScale(Math.max(min, viewMinX));
    const endX = xScale(Math.min(max, viewMaxX));
    const widthValue = Math.max(1.5, Math.abs(endX - startX));

    return {
      x: Math.min(startX, endX),
      width: widthValue,
    };
  }, [highlightRange, viewMinX, viewMaxX, plotWidth]);
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
    const spanY = Math.min(fullY, Math.max(1, next.maxY - fullDomain.minY));
    let minDomainX = next.minX;
    const minDomainY = fullDomain.minY;

    if (minDomainX < fullDomain.minX) minDomainX = fullDomain.minX;
    if (minDomainX + spanX > fullDomain.maxX) minDomainX = fullDomain.maxX - spanX;

    return {
      minX: minDomainX,
      maxX: minDomainX + spanX,
      minY: minDomainY,
      maxY: Math.min(fullDomain.maxY, roundUpToTickInterval(minDomainY + spanY, getNiceYAxisInterval(minDomainY, minDomainY + spanY))),
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
    const maxLeft = Math.max(8, rect.width - 372);
    return {
      x: Math.min(maxLeft, Math.max(8, event.clientX - rect.left + 12)),
      y: Math.max(8, event.clientY - rect.top + 12),
    };
  };
  const showTooltip = (event, point) => {
    const key = getTooltipPointKey(point);
    const nextTooltip = {
      key,
      rows: getPointTooltipRows(point),
      ...getTooltipPosition(event),
    };

    setTooltip((current) => {
      if (current?.key === key) return current;
      return nextTooltip;
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
    else setTooltip((current) => (current ? null : current));
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

  const yAxisElements = useMemo(
    () =>
      yTicks.map((tick) => {
        const y = yScale(tick);

        return (
          <g key={tick}>
            <line className="axisTick" x1={padding.left - 4} x2={padding.left} y1={y} y2={y} />
            <text className="axisText" x={padding.left - 8} y={y + 4} textAnchor="end">
              {formatAxisTick(tick)}
            </text>
          </g>
        );
      }),
    [yTicks, viewMinY, viewMaxY, plotHeight],
  );
  const xAxisElements = useMemo(
    () =>
      xTicks.map((tick, index) => (
        <text key={tick} className="axisText" x={xScale(tick)} y={height - 17} textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}>
          {formatShortDate(tick, axisPoints)}
        </text>
      )),
    [xTicks, axisPoints, viewMinX, viewMaxX, plotWidth],
  );
  const pmEventElements = useMemo(
    () =>
      pmEvents
        .map((event) => ({ ...event, x: toTime(event.inprg_dt, event) }))
        .filter((event) => event.x !== null && event.x >= viewMinX && event.x <= viewMaxX)
        .map((event, index) => {
          const isWarningAsset = !hasPmAssetSeparator(event.asset);

          return (
            <g key={`${event.inprg_dt}-${index}`}>
              <line className={`pmLine ${isWarningAsset ? 'warning' : ''}`} x1={xScale(event.x)} x2={xScale(event.x)} y1={padding.top} y2={height - padding.bottom} />
              <text className={`pmText ${isWarningAsset ? 'warning' : ''}`} x={xScale(event.x) + 4} y={padding.top + 12}>
                {event.work_type}
              </text>
            </g>
          );
        }),
    [pmEvents, viewMinX, viewMaxX, plotWidth],
  );
  const scatterPathElements = useMemo(
    () => (
      <>
        {scatterPathItems.map((item) => (
          <path key={`${item.className}-border`} className="pointBorderLayer" d={item.borderD} pointerEvents="none" />
        ))}
        {scatterPathItems.map((item) => (
          <path key={item.className} className={`${item.className} pointFillLayer`} d={item.d} pointerEvents="none" />
        ))}
      </>
    ),
    [scatterPathItems],
  );

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
          {yAxisElements}
          {xAxisElements}
          <line className="axisLine" x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} />
          <line className="axisLine" x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} />
          <g clipPath={`url(#${clipId})`}>
            {timeHighlight && (
              <rect className="timeHighlightBand" x={timeHighlight.x} y={padding.top} width={timeHighlight.width} height={plotHeight} pointerEvents="none" />
            )}
            {pmEventElements}
            {scatterPathElements}
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
const PM_TABLE_COLUMNS = ['asset', 'work_type', 'inprg_dt', 'description', 'Link'];
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

function getNgTablePoints(points, ngIdentitySet, eqpId) {
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
}

function getTkoutTimeRange(points) {
  const times = points
    .map((point) => toTime(point?.tkout_time, point))
    .filter((value) => Number.isFinite(value));

  if (times.length === 0) return null;

  return {
    min: Math.min(...times),
    max: Math.max(...times),
  };
}

function formatTableValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number' && Number.isFinite(value)) return value.toLocaleString();
  return String(value);
}

function normalizeDefectMapField(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isNaN(value)) return '';

  const text = String(value).trim();
  return text.toLowerCase() === 'nan' ? '' : text;
}

function getFirstDefectMapField(point, keys) {
  for (const key of keys) {
    const value = normalizeDefectMapField(point?.[key]);
    if (value) return value;
  }

  return '';
}

function getDefectMapFieldValue(point, field) {
  if (field === 'lotId') return getFirstDefectMapField(point, ['LOT_ID', 'lot_id', 'lot_wf', 'LOT_WF']);
  if (field === 'waferId') return getFirstDefectMapField(point, ['WAFER_ID', 'wafer_id']);
  if (field === 'stepSeq') return getFirstDefectMapField(point, ['STEP_SEQ', 'step_seq']);
  return '';
}

function getDefectMapUrl(urlTemplate, point) {
  if (!urlTemplate) return '';

  const placeholders = urlTemplate.match(/\{\}/g) ?? [];
  if (placeholders.length !== 3) return '';

  const values = [
    getDefectMapFieldValue(point, 'lotId'),
    getDefectMapFieldValue(point, 'waferId'),
    getDefectMapFieldValue(point, 'stepSeq'),
  ];

  if (values.some((value) => !value)) return '';

  let index = 0;
  return urlTemplate.replace(/\{\}/g, () => encodeURIComponent(values[index++]));
}

function getNgTableValue(point, column, row, eqpId) {
  if (column === 'tkout_time') return point.tkout_time_text || point.tkout_time;
  if (column === 'eqp_id') return point.eqp_id ?? point.eqpid ?? point.eqp_ch ?? point.eqpch ?? eqpId;
  if (column === 'lot_id') return point.lot_id ?? point.LOT_ID ?? point.lot_wf ?? point.LOT_WF;
  if (column === 'item_id') return point.item_id ?? getMetStepDisplay(row.metStep).metItem;
  return point[column] ?? point[column.toUpperCase()];
}

function NgPointTable({ points, row, eqpId }) {
  const defectMapConfig = useDefectMapUrlTemplate();

  return (
    <div className="ngTableShell">
      <table className="ngPointTable">
        <thead>
          <tr>
            {NG_TABLE_COLUMNS.map((column) => (
              <th key={column}>{column}</th>
            ))}
            <th>Defect MAP</th>
          </tr>
        </thead>
        <tbody>
          {points.length > 0 ? (
            points.map((point, index) => {
              const defectMapUrl = getDefectMapUrl(defectMapConfig.template, point);
              const disabledTitle = defectMapConfig.loading
                ? 'Defect MAP URL을 읽는 중입니다.'
                : defectMapConfig.error || 'LOT_ID, WAFER_ID, STEP_SEQ를 확인할 수 없습니다.';

              return (
                <tr key={`${point.anomaly_type ?? 'ng'}-${point.tkout_time_ms ?? point.tkout_time}-${index}`}>
                  {NG_TABLE_COLUMNS.map((column) => (
                    <td key={column}>{formatTableValue(getNgTableValue(point, column, row, eqpId))}</td>
                  ))}
                  <td className="defectMapCell">
                    {defectMapUrl ? (
                      <a className="defectMapButton" href={defectMapUrl} target="_blank" rel="noreferrer">
                        Defect MAP보기
                      </a>
                    ) : (
                      <span className="defectMapButton disabled" title={disabledTitle}>
                        Defect MAP보기
                      </span>
                    )}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={NG_TABLE_COLUMNS.length + 1}>NG 데이터가 없습니다.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function getPmTableValue(event, column) {
  if (column === 'inprg_dt') return event.inprg_dt_text || event.inprg_dt;
  return event[column];
}

function getPmLinkUrl(event) {
  const value = event?.url;
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isNaN(value)) return '';
  const text = String(value).trim();
  return text.toLowerCase() === 'nan' ? '' : text;
}

function PmEventTable({ events }) {
  return (
    <div className="ngTableShell pmTableShell">
      <table className="ngPointTable pmEventTable">
        <thead>
          <tr>
            {PM_TABLE_COLUMNS.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.length > 0 ? (
            events.map((event, index) => {
              const linkUrl = getPmLinkUrl(event);

              return (
                <tr key={`${event.inprg_dt_ms ?? event.inprg_dt}-${event.asset ?? ''}-${index}`}>
                  {PM_TABLE_COLUMNS.map((column) => {
                    if (column === 'Link') {
                      return (
                        <td key={column} className="pmLinkCell">
                          {linkUrl ? (
                            <a className="pmLinkButton" href={linkUrl} target="_blank" rel="noreferrer">
                              Link
                            </a>
                          ) : (
                            <span className="pmLinkButton disabled">Link</span>
                          )}
                        </td>
                      );
                    }

                    return <td key={column}>{formatTableValue(getPmTableValue(event, column))}</td>;
                  })}
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={PM_TABLE_COLUMNS.length}>PM 이력 데이터가 없습니다.</td>
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

function ChartTag({ anomalyType, anomalyTypes }) {
  const types = anomalyTypes?.length ? anomalyTypes : [anomalyType ?? 'center'];
  return (
    <div className="chartTags" aria-label="이상 유형">
      {types.map((type) => {
        const meta = ANOMALY_META[type] ?? ANOMALY_META.center;

        return (
          <span key={type} className={`anomalyTag ${meta.tagClass}`}>
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

function getChartPathEntries(data) {
  const paths = data?.paths ?? {};
  const pathLabels = data?.pathLabels ?? {};
  const resolvedPaths = data?.diagnostics?.resolvedPaths ?? {};
  const entries = [
    ['all', paths.all ?? resolvedPaths.allPath],
    ['fail', paths.fail ?? resolvedPaths.failPath],
    ['std', paths.std ?? resolvedPaths.stdPath],
  ];

  return entries.filter(([, value]) => value).map(([label, value]) => [pathLabels[label] ?? label, value]);
}

function ChartFailurePaths({ data }) {
  const entries = getChartPathEntries(data);
  if (entries.length === 0) return null;

  return (
    <div className="chartFailurePaths">
      {entries.map(([label, path]) => (
        <div key={label}>
          <strong>{label}</strong>
          <code>{path}</code>
        </div>
      ))}
    </div>
  );
}

function ChartFailureCard({ row, eqpId, error, data }) {
  return (
    <div className="chartShell">
      <div className="chartTitle">
        <div className="chartTitleText">
          <strong>{eqpId}</strong>
          <span>{getChartHeading(row, data)}</span>
        </div>
        <span className="chartStatusText">read failed</span>
      </div>
      <div className="emptyChartBody">
        <p>{error || '차트 데이터를 찾지 못했습니다.'}</p>
        <ChartFailurePaths data={data} />
      </div>
    </div>
  );
}

function FccRelatedChartGroup({ row, eqpId, sections }) {
  const visibleLabels = [...new Set(sections.map((section) => section.label))];

  return (
    <section className="fccRelatedChartGroup" aria-label={`${eqpId} FCC 연관 chart`}>
      <div className="fccRelatedChartHeader">
        <div className="fccRelatedChartTitle">
          <strong>{eqpId}</strong>
          <span>{getChartHeading(row)} / FCC 중심치 연관</span>
        </div>
        <div className="fccRelatedChartTags" aria-label="FCC chart category">
          {visibleLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>
      <div className="fccRelatedChartStack">
        {sections.map((section) => (
          <div key={section.key} className={`fccRelatedChartItem ${section.tone}`}>
            <span className="fccRelatedChartItemLabel">{section.label}</span>
            {section.element}
          </div>
        ))}
      </div>
    </section>
  );
}

function AnomalyChartCard({ row, eqpId, chartData, anomalyType = 'center', points = [], centerPoints = null, stdPoints = null, highlightRange = null, titleAction = null }) {
  const [isTableOpen, setIsTableOpen] = useState(false);
  const [isPmTableOpen, setIsPmTableOpen] = useState(false);
  const resolvedCenterPoints = centerPoints ?? (anomalyType === 'center' ? points : []);
  const resolvedStdPoints = stdPoints ?? (anomalyType === 'std' ? points : []);
  const pmEvents = chartData.pmEvents ?? [];
  const anomalyTypes = [
    resolvedCenterPoints.length > 0 ? 'center' : '',
    resolvedStdPoints.length > 0 ? 'std' : '',
  ].filter(Boolean);
  const visibleAnomalyTypes = anomalyTypes.length > 0 ? anomalyTypes : [anomalyType];
  const titleLabel = visibleAnomalyTypes.map((type) => ANOMALY_META[type]?.label ?? ANOMALY_META.center.label).join(' / ');
  const isFccCenterSourceChart = row?.dataKind === 'fcc' && row?.chartRoot === 'step' && visibleAnomalyTypes.includes('center');
  const combinedPoints = useMemo(() => [...resolvedCenterPoints, ...resolvedStdPoints], [resolvedCenterPoints, resolvedStdPoints]);
  const ngIdentitySet = useMemo(() => buildNgIdentitySet(combinedPoints), [combinedPoints]);
  const ngTablePoints = useMemo(() => getNgTablePoints(combinedPoints, ngIdentitySet, eqpId), [combinedPoints, ngIdentitySet, eqpId]);
  const cardId = String(`${eqpId}-${visibleAnomalyTypes.join('-')}-${row?.key ?? ''}`).replace(/[^a-zA-Z0-9_-]/g, '-');
  const tableId = `ng-table-${cardId}`;
  const pmTableId = `pm-table-${cardId}`;
  const chartAnomalyType = visibleAnomalyTypes.join('-');
  const chartDomains = visibleAnomalyTypes.length === 1 ? getTypedDomains(chartData.domains ?? null, visibleAnomalyTypes[0]) : chartData.domains;

  return (
    <div className={`chartShell ${isFccCenterSourceChart ? 'fccCenterSourceChart' : ''}`}>
      <div className="chartTitle">
        <div className="chartTitleText">
          <strong>{eqpId}</strong>
          <span>
            {getChartHeading(row, chartData)} / {titleLabel}
          </span>
        </div>
        <div className="chartTitleActions">
          {titleAction}
          <ChartTag anomalyTypes={visibleAnomalyTypes} />
        </div>
      </div>
      <ScatterChart
        allPoints={chartData.allPoints ?? []}
        failPoints={resolvedCenterPoints}
        stdPoints={resolvedStdPoints}
        pmEvents={pmEvents}
        domains={chartDomains}
        eqpId={eqpId}
        anomalyType={chartAnomalyType}
        highlightRange={highlightRange}
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
      <button className="ngTableToggle pmTableToggle" type="button" onClick={() => setIsPmTableOpen((current) => !current)} aria-expanded={isPmTableOpen} aria-controls={pmTableId}>
        <span className={`chevron ${isPmTableOpen ? 'open' : ''}`} aria-hidden="true">
          ▸
        </span>
        <span>PM 이력 보기</span>
        <strong>{pmEvents.length.toLocaleString()} rows</strong>
      </button>
      {isPmTableOpen && (
        <div id={pmTableId}>
          <PmEventTable events={pmEvents} />
        </div>
      )}
    </div>
  );
}

function ManagementStepChartCard({ chart, eqpId }) {
  const row = chart.row ?? {};
  const title = [row.lineCode, row.device, getChartHeading(row, chart)].filter(Boolean).join(' / ');

  if (chart.ok === false) {
    return <ChartFailureCard row={row} eqpId={eqpId} error={chart.error || '관리 STEP all scatter 데이터를 찾지 못했습니다.'} data={chart} />;
  }

  return (
    <section className="managementChartPanel">
      <div className="managementChartTitle">
        <strong>{title || '관리 STEP CHART'}</strong>
        <span>{(chart.highlightPoints?.length ?? 0).toLocaleString()} highlighted</span>
      </div>
      <ScatterChart
        allPoints={chart.allPoints ?? []}
        failPoints={chart.highlightPoints ?? []}
        stdPoints={[]}
        pmEvents={[]}
        domains={chart.domains}
        eqpId={eqpId}
        anomalyType="management"
      />
    </section>
  );
}

function ManagementStepChartModal({ row, eqpId, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', data: null });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      mainStep: row.mainStepPath ?? row.mainStep,
      chartMetStep: getChartMetStep(row),
      eqpId,
      t: String(Date.now()),
    });

    setState({ loading: true, error: '', data: null });
    fetchJson(`/api/fcc-management-chart?${params.toString()}`, { signal: controller.signal })
      .then((payload) => setState({ loading: false, error: '', data: payload }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ loading: false, error: error.message, data: error.payload ?? null });
      });

    return () => controller.abort();
  }, [row, eqpId]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const charts = state.data?.charts ?? [];

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="managementModal" role="dialog" aria-modal="true" aria-label={`${eqpId} 관리 STEP CHART`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="managementModalHeader">
          <div>
            <strong>{eqpId}</strong>
            <span>{getChartHeading(row)} / 관리 STEP CHART</span>
          </div>
          <button className="modalCloseButton" type="button" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>

        <div className="managementModalBody">
          {state.loading && <div className="emptyMiniState">관리 STEP all scatter 파일을 읽고 있습니다.</div>}
          {!state.loading && state.error && (
            <div className="emptyChartBody">
              <p>{state.error}</p>
              <ChartFailurePaths data={state.data} />
            </div>
          )}
          {!state.loading && !state.error && charts.length === 0 && (
            <div className="emptyChartBody">
              <p>FCC 중심치 이상목록의 main_step과 매칭되는 관리 STEP MET 매핑을 찾지 못했습니다.</p>
            </div>
          )}
          {!state.loading && !state.error && charts.length > 0 && charts.map((chart, index) => <ManagementStepChartCard key={chart.row?.key ?? index} chart={chart} eqpId={eqpId} />)}
        </div>
      </section>
    </div>
  );
}

function EquipmentChart({ row, eqpId, onLatestDate, chartEndpoint = '/api/chart' }) {
  const [chartState, setChartState] = useState({ loading: true, error: '', data: null });
  const [isManagementModalOpen, setIsManagementModalOpen] = useState(false);
  const resolvedChartEndpoint = getEquipmentChartEndpoint(row, chartEndpoint);
  const suppressExtraCharts = isFccSingleRow(row);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      mainStep: row.mainStepPath ?? row.mainStep,
      chartMetStep: getChartMetStep(row),
      eqpId,
      chartRoot: row.chartRoot ?? 'step',
      t: String(Date.now()),
    });
    if (row.dataKind === 'chamber') {
      params.set('lineCode', row.lineCode ?? '');
      params.set('device', row.device ?? '');
      params.set('lineName', row.lineName ?? '');
    }
    if (suppressExtraCharts) params.set('suppressExtraCharts', '1');

    setChartState({ loading: true, error: '', data: null });
    fetchJson(`${resolvedChartEndpoint}?${params.toString()}`, { signal: controller.signal })
      .then((payload) => {
        setChartState({ loading: false, error: '', data: payload });
        if (payload.latestDate) onLatestDate?.(payload.latestDate);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setChartState({ loading: false, error: error.message, data: error.payload ?? null });
      });

    return () => controller.abort();
  }, [eqpId, onLatestDate, resolvedChartEndpoint, row, suppressExtraCharts]);

  useEffect(() => {
    setIsManagementModalOpen(false);
  }, [row?.key, eqpId]);

  const failPoints = chartState.data?.failPoints ?? [];
  const stdPoints = chartState.data?.stdPoints ?? [];
  const extraCenterCharts = suppressExtraCharts ? [] : (chartState.data?.extraCenterCharts ?? []);
  const extraStdCharts = suppressExtraCharts ? [] : (chartState.data?.extraStdCharts ?? []);
  const timefitCharts = suppressExtraCharts ? [] : (chartState.data?.timefitCharts ?? []);
  const shouldDrawCenter = eqpListIncludes(row.centerEqpIds, eqpId);
  const shouldDrawStd = eqpListIncludes(row.stdEqpIds, eqpId);
  const centerPoints = shouldDrawCenter ? failPoints : [];
  const stdChartPoints = shouldDrawStd ? stdPoints : [];
  const centerNgIdentitySet = useMemo(() => buildNgIdentitySet(centerPoints), [centerPoints]);
  const centerNgTablePoints = useMemo(() => getNgTablePoints(centerPoints, centerNgIdentitySet, eqpId), [centerPoints, centerNgIdentitySet, eqpId]);
  const extraCenterHighlightRange = useMemo(() => getTkoutTimeRange(centerNgTablePoints), [centerNgTablePoints]);
  const hasExtraCharts = extraCenterCharts.length > 0 || extraStdCharts.length > 0 || timefitCharts.length > 0;
  const hasBaseChart = centerPoints.length > 0 || stdChartPoints.length > 0;
  const isFccRelatedChart = row?.dataKind === 'fcc' && row?.chartRoot === 'step';
  const managementTitleAction = isFccRelatedChart ? (
    <button className="managementChartButton" type="button" onClick={() => setIsManagementModalOpen(true)}>
      관리STEP CHART 보기
    </button>
  ) : null;

  if (chartState.loading || chartState.error || (!hasBaseChart && !hasExtraCharts)) {
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
                ? chartState.error
                : '선택한 eqp_id에서 중심치/산포 이상 데이터를 찾지 못했습니다.'}
          </p>
          {!chartState.loading && <ChartFailurePaths data={chartState.data} />}
        </div>
      </div>
    );
  }

  const chartSections = [];

  if (hasBaseChart) {
    chartSections.push({
      key: `${eqpId}-base`,
      label: 'FCC 중심치 이상',
      tone: 'base',
      element: (
        <AnomalyChartCard
          row={row}
          eqpId={eqpId}
          chartData={chartState.data}
          anomalyType={centerPoints.length > 0 ? 'center' : 'std'}
          centerPoints={centerPoints}
          stdPoints={stdChartPoints}
          titleAction={managementTitleAction}
        />
      ),
    });
  }

  extraCenterCharts.forEach((chart, index) => {
    const key = `${eqpId}-extra-center-${chart.row?.key ?? index}`;
    chartSections.push({
      key,
      label: '연관 step 중심치 이상',
      tone: 'extraCenter',
      element:
        chart.ok !== false && (chart.failPoints?.length ?? 0) > 0 ? (
          <AnomalyChartCard
            row={chart.row ?? row}
            eqpId={eqpId}
            chartData={chart}
            anomalyType="center"
            points={chart.failPoints}
            highlightRange={extraCenterHighlightRange}
          />
        ) : (
          <ChartFailureCard
            row={chart.row ?? row}
            eqpId={eqpId}
            error={chart.error || 'FCC 추가 중심치 chart 데이터를 찾지 못했습니다.'}
            data={chart}
          />
        ),
    });
  });

  extraStdCharts.forEach((chart, index) => {
    const key = `${eqpId}-extra-std-${chart.row?.key ?? index}`;
    chartSections.push({
      key,
      label: 'FCC 추가 산포 이상',
      tone: 'extraStd',
      element:
        chart.ok !== false && (chart.stdPoints?.length ?? 0) > 0 ? (
          <AnomalyChartCard
            row={chart.row ?? row}
            eqpId={eqpId}
            chartData={chart}
            anomalyType="std"
            points={chart.stdPoints}
          />
        ) : (
          <ChartFailureCard
            row={chart.row ?? row}
            eqpId={eqpId}
            error={chart.error || 'FCC 추가 산포 chart 데이터를 찾지 못했습니다.'}
            data={chart}
          />
        ),
    });
  });

  timefitCharts.forEach((chart, index) => {
    const key = `${eqpId}-timefit-${chart.row?.key ?? index}`;
    const chartRow = {
      ...row,
      ...(chart.row ?? {}),
      stepDesc: chart.row?.stepDesc || row.stepDesc,
      sdwt: chart.row?.sdwt || row.sdwt,
      metItem2: chart.row?.metItem2 || row.metItem2,
    };

    chartSections.push({
      key,
      label: 'FCC 이상시점 fail 중심치 이상 scatter',
      tone: 'timefit',
      element:
        chart.ok !== false && (chart.failPoints?.length ?? 0) > 0 ? (
          <AnomalyChartCard
            row={chartRow}
            eqpId={eqpId}
            chartData={chart}
            anomalyType="center"
            points={chart.failPoints}
          />
        ) : (
          <ChartFailureCard
            row={chartRow}
            eqpId={eqpId}
            error={chart.error || 'FCC 이상시점 fail 중심치 이상 scatter 데이터를 찾지 못했습니다.'}
            data={chart}
          />
        ),
    });
  });

  const renderedCharts = isFccRelatedChart ? (
    <FccRelatedChartGroup row={row} eqpId={eqpId} sections={chartSections} />
  ) : (
    <>{chartSections.map((section) => <React.Fragment key={section.key}>{section.element}</React.Fragment>)}</>
  );

  return (
    <>
      {renderedCharts}
      {isManagementModalOpen && <ManagementStepChartModal row={row} eqpId={eqpId} onClose={() => setIsManagementModalOpen(false)} />}
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

const HOME_CARDS = [
  {
    key: 'chamber',
    title: '전라인 챔버별 이상감지',
    subtitle: '챔버 기준 이상감지 화면입니다.',
    category: 'Chamber',
    icon: 'network',
    badge: 'Open',
  },
  {
    key: 'main',
    title: 'P3D MAIN 설비별 이상감지',
    subtitle: '대상스탭 기준으로 MAIN 설비별 이상 chart를 확인합니다.',
    category: 'Main',
    icon: 'activity',
    badge: 'Open',
  },
  {
    key: 'fcc',
    title: 'P3D FCC지수 이상감지',
    subtitle: 'FCC지수 연관 이상감지 항목과 추가 chart를 확인합니다.',
    category: 'FCC',
    icon: 'chart',
    badge: 'Open',
  },
];

const SPIDER_SUITE_CARDS = [
  {
    key: 'l0',
    title: 'L0 SPIDER',
    subtitle: 'FDC Trend기반 이상 패턴을 탐색합니다.',
    category: 'L0',
    icon: 'chart',
    badge: 'Open',
    href: 'https://go/spider',
  },
  {
    key: 'l1',
    title: 'L1 SPIDER',
    subtitle: 'L1 Trend 기반 이상 패턴을 탐색 합니다.',
    category: 'L1',
    icon: 'activity',
    badge: 'Open',
    href: 'https://go/spider1',
  },
];

function HomeIcon({ type }) {
  if (type === 'activity') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
      </svg>
    );
  }

  if (type === 'chart') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 16v5" />
        <path d="M16 14v7" />
        <path d="M20 10v11" />
        <path d="m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.708 0L2 15" />
        <path d="M4 18v3" />
        <path d="M8 14v7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
      <path d="M12 8v8" />
    </svg>
  );
}

function HomeCategoryCard({ card, onSelect }) {
  const handleClick = () => {
    if (card.href) {
      const popup = window.open(card.href, '_blank', 'noopener,noreferrer');
      if (popup) popup.opener = null;
      return;
    }

    onSelect(card.key);
  };

  return (
    <button className="spiderAppCard" type="button" onClick={handleClick}>
      <span className={card.badge === '공사중' ? 'spiderAppBadge isConstruction' : 'spiderAppBadge'}>{card.badge ?? 'Open'}</span>
      <span className="spiderAppIcon">
        <HomeIcon type={card.icon} />
      </span>
      <span className="spiderAppBody">
        <strong>{card.title}</strong>
        <span>{card.subtitle}</span>
      </span>
      <span className="spiderAppCategory">{card.category}</span>
    </button>
  );
}

function HomePage({ onSelect }) {
  return (
    <main className="spiderHome">
      <section className="spiderHomeHero">
        <div className="spiderHomeHeroInner">
          <div className="spiderHomeTitleBlock">
            <span className="homeBadge">L1 SPIDER</span>
            <h1>Defect SPIDER</h1>
            <p>Defect및 L1, L0 이상감지 메뉴를 한 화면에서 시작합니다.</p>
          </div>
        </div>
      </section>

      <section className="spiderHomeContent">
        <section className="spiderHomeSection">
          <div className="spiderHomeSectionTitle">
            <h2>Defect SPIDER App</h2>
            <p>분석 기준별 이상감지 화면입니다.</p>
          </div>
          <div className="spiderAppGrid">
            {HOME_CARDS.map((card) => (
              <HomeCategoryCard key={card.key} card={card} onSelect={onSelect} />
            ))}
          </div>
        </section>

        <section className="spiderHomeSection">
          <div className="spiderHomeSectionTitle">
            <h2>L0, L1 이상감지 App</h2>
            <p>L0와 L3 데이터를 활용한 이상감지 App입니다</p>
          </div>
          <div className="spiderAppGrid">
            {SPIDER_SUITE_CARDS.map((card) => (
              <HomeCategoryCard key={card.key} card={card} onSelect={onSelect} />
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function ConstructionView({ onBack, onClickHistory }) {
  const [lineState, setLineState] = useState(EMPTY_CHAMBER_LINES_STATE);
  const [chamberLoadState, setChamberLoadState] = useState(EMPTY_CHAMBER_LOAD_STATE);
  const [selectedLineName, setSelectedLineName] = useState('');
  const [selectedDeviceKey, setSelectedDeviceKey] = useState('');
  const [selectedChamberSdwt, setSelectedChamberSdwt] = useState('ALL');
  const [selectedChamberMetStep, setSelectedChamberMetStep] = useState(null);
  const [chamberLatestDate, setChamberLatestDate] = useState('');
  const selectedLine = lineState.rows.find((line) => line.lineName === selectedLineName) ?? lineState.rows[0] ?? null;
  const selectedLineDevices = useMemo(() => {
    if (selectedLine?.devices?.length > 0) return selectedLine.devices;
    if (selectedLine?.lineCode && selectedLine?.device) return [{ key: `${selectedLine.lineCode}::${selectedLine.device}`, lineCode: selectedLine.lineCode, device: selectedLine.device }];
    return [];
  }, [selectedLine]);
  const selectedDevice = selectedLineDevices.find((device) => device.key === selectedDeviceKey) ?? selectedLineDevices[0] ?? null;
  const chamberSdwtOptions = useMemo(() => buildSdwtOptions(chamberLoadState.rows), [chamberLoadState.rows]);
  const filteredChamberRows = useMemo(() => filterRowsBySdwt(chamberLoadState.rows, selectedChamberSdwt), [chamberLoadState.rows, selectedChamberSdwt]);
  const chamberStepGroups = useMemo(() => groupRowsByMainStep(filteredChamberRows), [filteredChamberRows]);
  const selectedChamberEqpIds = getPrioritizedEqpIds(selectedChamberMetStep);
  const chamberMetStepCount = chamberStepGroups.reduce((sum, group) => sum + group.metSteps.length, 0);
  const chamberEqpCount = filteredChamberRows.reduce((sum, row) => sum + (row.eqpIds?.length ?? 0), 0);
  const chamberMetricCards = [
    { label: '메인 스탭', value: chamberStepGroups.length.toLocaleString() },
    { label: '계측 스탭', value: chamberMetStepCount.toLocaleString() },
    { label: '감지 댓수', value: chamberEqpCount.toLocaleString() },
  ];

  useEffect(() => {
    let cancelled = false;

    fetchJson(`/api/chamber-lines?t=${Date.now()}`)
      .then((payload) => {
        if (cancelled) return;

        const rows = payload.rows ?? [];
        setLineState({
          loading: false,
          error: '',
          apiPath: '/api/chamber-lines',
          rows,
          sources: payload.sources ?? EMPTY_CHAMBER_LINES_STATE.sources,
          diagnostics: payload.diagnostics ?? EMPTY_CHAMBER_LINES_STATE.diagnostics,
        });
        setSelectedLineName((current) => current || rows[0]?.lineName || '');
      })
      .catch((error) => {
        if (cancelled) return;

        setLineState({
          loading: false,
          error: error.message,
          apiPath: error.requestUrl ?? '/api/chamber-lines',
          rows: error.payload?.rows ?? [],
          sources: error.payload?.sources ?? EMPTY_CHAMBER_LINES_STATE.sources,
          diagnostics: error.payload?.diagnostics ?? EMPTY_CHAMBER_LINES_STATE.diagnostics,
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedDeviceKey((current) => {
      if (current && selectedLineDevices.some((device) => device.key === current)) return current;
      return selectedLineDevices[0]?.key ?? '';
    });
  }, [selectedLineDevices]);

  useEffect(() => {
    setSelectedChamberSdwt((current) => (chamberSdwtOptions.includes(current) ? current : 'ALL'));
  }, [chamberSdwtOptions]);

  useEffect(() => {
    setChamberLatestDate('');
    setSelectedChamberMetStep(null);

    if (!selectedDevice) {
      setChamberLoadState(EMPTY_CHAMBER_LOAD_STATE);
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({
      lineCode: selectedDevice.lineCode,
      device: selectedDevice.device,
      lineName: selectedLine?.lineName ?? '',
      t: String(Date.now()),
    });
    const chamberSummaryPath = `/api/chamber-summary?lineCode=${encodeURIComponent(selectedDevice.lineCode)}&device=${encodeURIComponent(selectedDevice.device)}&lineName=${encodeURIComponent(selectedLine?.lineName ?? '')}`;

    setChamberLoadState({
      ...EMPTY_CHAMBER_LOAD_STATE,
      loading: true,
      apiPath: chamberSummaryPath,
    });

    fetchJson(`/api/chamber-summary?${params.toString()}`)
      .then((payload) => {
        if (cancelled) return;

        setChamberLoadState({
          loading: false,
          error: '',
          apiPath: chamberSummaryPath,
          rows: payload.rows ?? [],
          sources: payload.sources ?? [],
          diagnostics: payload.diagnostics ?? EMPTY_CHAMBER_LOAD_STATE.diagnostics,
        });
      })
      .catch((error) => {
        if (cancelled) return;

        setChamberLoadState({
          loading: false,
          error: error.message,
          apiPath: error.requestUrl ?? chamberSummaryPath,
          rows: error.payload?.rows ?? [],
          sources: error.payload?.sources ?? [],
          diagnostics: error.payload?.diagnostics ?? EMPTY_CHAMBER_LOAD_STATE.diagnostics,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDevice, selectedLine?.lineName]);

  useEffect(() => {
    const firstMetStep = chamberStepGroups[0]?.metSteps[0] ?? null;
    setSelectedChamberMetStep((current) => {
      if (current && chamberStepGroups.some((group) => group.metSteps.some((row) => row.key === current.key))) return current;
      return firstMetStep;
    });
  }, [chamberStepGroups]);

  useEffect(() => {
    setChamberLatestDate('');
  }, [selectedChamberMetStep?.key, selectedDevice?.key]);

  return (
    <main className="app hasFloatingHomeButton chamberView">
      <button className="homeBackButton" type="button" onClick={onBack}>
        메인 메뉴
      </button>
      <header className="topBar chamberTopBar">
        <div>
          <h1>Defect SPIDER</h1>
        </div>
      </header>

      {selectedDevice && (
        <SourceStatusBanner
          loading={chamberLoadState.loading}
          error={chamberLoadState.error}
          sources={chamberLoadState.sources}
          diagnostics={chamberLoadState.diagnostics}
          latestDate={chamberLatestDate}
        />
      )}

      <section className="constructionPanel chamberLinePanel">
        <div className="chamberLineHeading">
          <div>
            <span className="homeBadge">Chamber</span>
            <h2>전라인 챔버별 이상감지</h2>
          </div>
          <span className="countBadge">{lineState.loading ? '-' : lineState.rows.length.toLocaleString()}</span>
        </div>

        {lineState.loading && (
          <div className="emptyPanel">
            <strong>라인 매핑 파일 읽는 중</strong>
            <span>개별 챔버 이상감지 라인 매핑파일을 확인하고 있습니다.</span>
          </div>
        )}

        {!lineState.loading && lineState.error && (
          <div className="emptyPanel">
            <strong>라인 매핑 파일 읽기 실패</strong>
            <span>{hideFilePaths(lineState.error)}</span>
          </div>
        )}

        {!lineState.loading && !lineState.error && lineState.rows.length === 0 && (
          <div className="emptyPanel">
            <strong>라인 없음</strong>
            <span>{lineState.diagnostics?.warnings?.[0] || 'line_mapping.txt에서 선택 가능한 line 값을 찾지 못했습니다.'}</span>
          </div>
        )}

        {!lineState.loading && !lineState.error && lineState.rows.length > 0 && (
          <>
            <div className="chamberLineGrid" aria-label="챔버 라인 선택">
              {lineState.rows.map((line) => (
                <button
                  key={line.lineName}
                  className={selectedLine?.lineName === line.lineName ? 'chamberLineButton active' : 'chamberLineButton'}
                  type="button"
                  onClick={() => setSelectedLineName(line.lineName)}
                >
                  <strong>{line.lineName}</strong>
                </button>
              ))}
            </div>

            {selectedLineDevices.length > 0 && (
              <div className="chamberDeviceSection">
                <div className="chamberDeviceHeader">제품 선택</div>
                <div className="chamberDeviceRow" aria-label="챔버 device 선택">
                  {selectedLineDevices.map((device) => (
                    <button
                      key={device.key}
                      className={selectedDevice?.key === device.key ? 'active' : ''}
                      type="button"
                      onClick={() => setSelectedDeviceKey(device.key)}
                    >
                      <strong>{device.device}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {selectedDevice && (
        <>
          <div className="topMetrics threeColumns">
            {chamberMetricCards.map((metric) => (
              <Metric key={metric.label} label={metric.label} value={metric.value} />
            ))}
          </div>

          <section className="workspace chamberWorkspace">
            <div className="leftRail">
              <SdwtSelector options={chamberSdwtOptions} selectedSdwt={selectedChamberSdwt} onSelect={setSelectedChamberSdwt} disabled={chamberLoadState.rows.length === 0} />
              <MainStepTree
                groups={chamberStepGroups}
                selectedMetStepKey={selectedChamberMetStep?.key}
                onSelectMetStep={(row) => {
                  setSelectedChamberMetStep(row);
                  onClickHistory(selectedLine?.lineName, row);
                }}
                loading={chamberLoadState.loading}
                error={chamberLoadState.error}
                diagnostics={chamberLoadState.diagnostics}
              />
            </div>

            <section className="detailPanel">
              <div className="detailHeader">
                <div>
                  <p className="eyebrow">Chamber Equipment Charts</p>
                  <h2>{getChartHeading(selectedChamberMetStep)}</h2>
                </div>
                <div className="statusChip">{chamberLoadState.error ? '파일 읽기 실패' : chamberLoadState.loading ? '파일 읽는 중' : '실제 파일 기반'}</div>
              </div>

              <div className="chartGrid">
                {selectedChamberMetStep && selectedChamberEqpIds.length > 0 ? (
                  selectedChamberEqpIds.map((eqpId) => (
                    <EquipmentChart key={`chamber-${selectedDevice.key}-${selectedChamberMetStep.key}-${eqpId}`} row={selectedChamberMetStep} eqpId={eqpId} onLatestDate={setChamberLatestDate} chartEndpoint="/api/chamber-chart" />
                  ))
                ) : (
                  <EmptyChartState selectedRow={selectedChamberMetStep} />
                )}
              </div>
            </section>
          </section>
        </>
      )}
      <button className="scrollTopButton" type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
        TOP
      </button>
    </main>
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
  const fccStepGroups = useMemo(() => groupRowsByMainStep(filteredFccRows, { prioritizeCenter: true }), [filteredFccRows]);
  const [selectedMetStep, setSelectedMetStep] = useState(null);
  const [selectedAdditionalMetStep, setSelectedAdditionalMetStep] = useState(null);
  const [activeChartSource, setActiveChartSource] = useState('main');
  const [currentView, setCurrentView] = useState('home');
  const [chartLatestDate, setChartLatestDate] = useState('');

  const handleClickHistory = (lineName, row) => {
    const request = getClickHistoryRequest(lineName, row);

    if (!request) return;
    uploadClickHistory(request).catch(() => {});
  };

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
          metrics: payload.metrics ?? EMPTY_FCC_LOAD_STATE.metrics,
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
          metrics: error.payload?.metrics ?? EMPTY_FCC_LOAD_STATE.metrics,
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
  }, [currentView, activeChartSource, activeChartSource === 'fcc' ? selectedAdditionalMetStep?.key : selectedMetStep?.key]);

  const activeSelectedRow = activeChartSource === 'fcc' ? selectedAdditionalMetStep : selectedMetStep;
  const activeLoadState = activeChartSource === 'fcc' ? fccLoadState : loadState;
  const activeChartEndpoint = activeChartSource === 'fcc' ? '/api/fcc-chart' : '/api/chart';
  const activeChartEyebrow = activeChartSource === 'fcc' ? 'FCC Equipment Charts' : 'Equipment Charts';
  const selectedEqpIds = activeChartSource === 'fcc' ? getPrioritizedFccEqpIds(activeSelectedRow) : getPrioritizedEqpIds(activeSelectedRow);

  const metStepCount = mainStepGroups.reduce((sum, group) => sum + group.metSteps.length, 0);
  const eqpCount = filteredRows.reduce((sum, row) => sum + (row.eqpIds?.length ?? 0), 0);
  const fccMetStepCount = fccStepGroups.reduce((sum, group) => sum + group.metSteps.length, 0);
  const fccEqpCount = filteredFccRows.reduce((sum, row) => sum + (row.eqpIds?.length ?? 0), 0);
  const activeChartLabel = activeChartSource === 'fcc' ? 'FCC 차트' : 'Main 차트';
  const fccMetrics = fccLoadState.metrics ?? EMPTY_FCC_LOAD_STATE.metrics;
  const metricCards =
    activeChartSource === 'fcc'
      ? [
          { label: '메인스탭', value: Number(fccMetrics.extraMetMainStepCount ?? 0).toLocaleString() },
          { label: '계측 스탭', value: Number(fccMetrics.extraMetStepCount ?? 0).toLocaleString() },
          { label: '감지 댓수', value: Number(fccMetrics.centerEqpCount ?? 0).toLocaleString() },
          { label: 'FCC 이상시점', value: `${Number(fccMetrics.timefitEqpCount ?? 0).toLocaleString()} eqp / ${Number(fccMetrics.timefitAnomalyCount ?? 0).toLocaleString()}건` },
        ]
      : [
          { label: '메인 스탭', value: mainStepGroups.length.toLocaleString() },
          { label: 'MET 스탭', value: metStepCount.toLocaleString() },
          { label: '감지 댓수', value: eqpCount.toLocaleString() },
          { label: 'FCC 스탭 / 댓수', value: `${fccMetStepCount.toLocaleString()} / ${fccEqpCount.toLocaleString()}` },
        ];

  const handleHomeSelect = (key) => {
    setChartLatestDate('');

    if (key === 'chamber') {
      setCurrentView('chamber');
      return;
    }

    setActiveChartSource(key);
    setCurrentView(key);
  };

  const handleBackHome = () => {
    setChartLatestDate('');
    setCurrentView('home');
  };

  if (currentView === 'home') {
    return <HomePage onSelect={handleHomeSelect} />;
  }

  if (currentView === 'chamber') {
    return <ConstructionView onBack={handleBackHome} onClickHistory={handleClickHistory} />;
  }

  return (
    <main className="app hasFloatingHomeButton">
      <button className="homeBackButton" type="button" onClick={handleBackHome}>
        메인 메뉴
      </button>
      <header className="topBar">
        <div>
          <p className="eyebrow">P3D Defect Spider</p>
          <h1>Defect SPIDER</h1>
        </div>
        <div className="topBarActions">
          <div className="summaryPills">
            <span>감지 라인 {CONFIG.lineName}</span>
            <span>선택 라인 {CONFIG.selectLine}</span>
            <span>Device {CONFIG.device}</span>
            <span>SDWT {selectedSdwt}</span>
            <span>{activeChartLabel}</span>
          </div>
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
        {metricCards.map((metric) => (
          <Metric key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </div>

      <section className="workspace">
        <div className="leftRail">
          <SdwtSelector options={sdwtOptions} selectedSdwt={selectedSdwt} onSelect={setSelectedSdwt} disabled={rows.length === 0 && fccRows.length === 0} />
          {activeChartSource === 'main' ? (
            <MainStepTree
              groups={mainStepGroups}
              selectedMetStepKey={selectedMetStep?.key}
              onSelectMetStep={(row) => {
                setSelectedMetStep(row);
                setActiveChartSource('main');
                setCurrentView('main');
                handleClickHistory(HISTORY_LINE_NAMES.main, row);
              }}
              loading={loadState.loading}
              error={loadState.error}
              diagnostics={loadState.diagnostics}
            />
          ) : (
            <AdditionalAnomalyStepTree
              groups={fccStepGroups}
              selectedMetStepKey={selectedAdditionalMetStep?.key}
              onSelectMetStep={(row) => {
                setSelectedAdditionalMetStep(row);
                setActiveChartSource('fcc');
                setCurrentView('fcc');
                handleClickHistory(HISTORY_LINE_NAMES.fcc, row);
              }}
              loading={fccLoadState.loading}
              error={fccLoadState.error}
              diagnostics={fccLoadState.diagnostics}
              sources={fccLoadState.sources}
              apiPath={fccLoadState.apiPath}
            />
          )}
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

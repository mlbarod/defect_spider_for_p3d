import React, { useEffect, useMemo, useState } from 'react';
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
    throw new Error(`/api 응답이 JSON이 아닙니다. 정적 서버나 Vite preview가 HTML을 반환했습니다: ${preview}`);
  }

  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error(`/api JSON 파싱 실패: ${error.message}`);
  }

  if (!response.ok || payload.ok === false) {
    throw Object.assign(new Error(payload.error || `${url} 요청 실패`), { payload });
  }

  return payload;
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

function getChartMetStep(row) {
  let rawMetStep = stripPercentPrefix(row.metStepPath ?? row.metStep);
  while (rawMetStep.endsWith('_main_main')) rawMetStep = rawMetStep.replace(/_main_main$/, '_main');
  if (isMainLine && rawMetStep.endsWith('_main')) return rawMetStep;

  const { metStepNo, metItem } = getMetStepDisplay(rawMetStep);
  const metStep = metItem ? `${metStepNo}_${metItem}` : metStepNo;

  return isMainLine ? `${metStep}_main` : metStep;
}

function getChartPaths(row, eqpId = '{eqp_id}') {
  const chartMetStep = getChartMetStep(row);
  const latestDate = row.latestDate ?? '{latestDate}';
  const mainStepPath = row.mainStepPath ?? row.mainStep;
  const base = `${folderPath}/${mainStepPath}/${chartMetStep}/${latestDate}`;

  return {
    eqpId,
    all: `${base}/${isMainLine ? 'main_all' : 'all'}_${mainStepPath}.parquet`,
    fail: `${base}/${isMainLine ? 'main_fail' : 'fail'}_${mainStepPath}.parquet`,
    pm: CONFIG.pmCodePath,
  };
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
      stepDesc: row.stepDesc,
      sdwt: row.sdwt,
      metSteps: [],
      centerCount: 0,
      stdCount: 0,
      eqpCount: 0,
    };

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

function SourceStatusBanner({ loading, error, sources, diagnostics }) {
  const missingSources = sources.filter((source) => !source.exists || !source.readable);
  const warningCount = diagnostics?.warnings?.length ?? 0;

  return (
    <section className={`sourceBanner ${error ? 'error' : ''}`}>
      <div>
        <p className="eyebrow">File Loader</p>
        <h2>{loading ? '원본 파일 읽는 중' : error ? '원본 파일 읽기 실패' : '원본 파일 연결됨'}</h2>
      </div>
      <div className="sourceBannerText">
        {error ? <strong>{error}</strong> : <span>웹 UI가 Vite API를 통해 표시된 원본 경로의 파일을 읽습니다.</span>}
        <span>
          loader {diagnostics?.version ?? 'unknown'} / 입력 {Object.values(diagnostics?.inputRows ?? {}).reduce((sum, value) => sum + Number(value || 0), 0).toLocaleString()}행 / 표시 {Number(diagnostics?.outputRows ?? 0).toLocaleString()}건
        </span>
        {missingSources.length > 0 && (
          <span>
            미확인 파일 {missingSources.length}개: {missingSources.map((source) => source.label).join(', ')}
          </span>
        )}
        {warningCount > 0 && <span>경고 {warningCount}개: {diagnostics.warnings.slice(0, 2).join(' / ')}</span>}
      </div>
    </section>
  );
}

function SdwtSelector({ options, selectedSdwt, onSelect, disabled }) {
  return (
    <section className="sdwtBar" aria-label="SDWT 선택">
      <div>
        <p className="eyebrow">SDWT Selection</p>
        <h2>SDWT 선택</h2>
      </div>
      <div className="segmentedControl">
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
    </section>
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
    <aside className="sidePanel" aria-label="메인 스텝 선택">
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
              : error ||
                `파일 입력 ${Object.values(diagnostics?.inputRows ?? {}).reduce((sum, value) => sum + Number(value || 0), 0).toLocaleString()}행 중 화면에 표시할 대상이 0건입니다.`}
          </span>
          {diagnostics?.warnings?.slice(0, 3).map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
          <code>{DATA_SOURCES[3].path}</code>
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
                    <span className="stepName">{group.mainStep}</span>
                    <span className="stepTrend">{group.stepDesc || group.sdwt || 'step_desc 확인 필요'}</span>
                  </span>
                  <span className="mainScore">{group.metSteps.length} met</span>
                </button>
                <span className="scoreBar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, group.centerCount + group.stdCount)}%` }} />
                </span>
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

function splitLotWf(value) {
  const text = String(value ?? '').trim();
  if (!text) return { lot: '', wf: '' };
  const separator = text.includes('/') ? '/' : text.includes('|') ? '|' : text.includes(',') ? ',' : text.includes('_') ? '_' : '';
  if (!separator) return { lot: text, wf: text };
  const parts = text.split(separator).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { lot: text, wf: text };
  return { lot: parts.slice(0, -1).join(separator), wf: parts.at(-1) };
}

function getPointLabel(point, fallbackEqpId) {
  const lotWfParts = splitLotWf(point.lot_wf);
  const lot = point.lot ?? point.lot_id ?? point.lotId ?? lotWfParts.lot;
  const wf = point.wf ?? point.wf_id ?? point.wafer ?? point.wafer_id ?? lotWfParts.wf;
  const eqp = point.eqp_id ?? point.eqpid ?? point.eqp_ch ?? fallbackEqpId;
  const time = point.tkout_time_text ?? point.tkout_time ?? point.time ?? '';

  return [
    `eqpid: ${eqp || '-'}`,
    `lot: ${lot || '-'}`,
    `wf: ${wf || '-'}`,
    `time: ${time || '-'}`,
  ].join('\n');
}

function ScatterChart({ allPoints, failPoints, pmEvents, eqpId }) {
  const [mode, setMode] = useState('in');
  const [viewDomain, setViewDomain] = useState(null);
  const [dragRange, setDragRange] = useState(null);
  const width = 720;
  const height = 238;
  const padding = { left: 56, right: 18, top: 22, bottom: 42 };
  const clipId = `plot-${String(eqpId).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const points = [...allPoints, ...failPoints]
    .map((point) => ({ ...point, x: toTime(point.tkout_time, point), y: toNumber(point.fab_value) }))
    .filter((point) => point.x !== null && point.y !== null);
  const hasPoints = points.length > 0;
  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const minX = hasPoints ? Math.min(...xValues) : 0;
  const maxX = hasPoints ? Math.max(...xValues) : 1;
  const minY = hasPoints ? Math.min(...yValues) : 0;
  const maxY = hasPoints ? Math.max(...yValues) : 1;
  const yPad = Math.max(1, (maxY - minY) * 0.12);
  const fullDomain = {
    minX,
    maxX,
    minY: minY - yPad,
    maxY: maxY + yPad,
  };

  useEffect(() => {
    setViewDomain(null);
    setDragRange(null);
  }, [allPoints, failPoints, eqpId]);

  if (!hasPoints) {
    return <div className="emptyMiniState">차트 parquet에서 tkout_time/fab_value 데이터를 찾지 못했습니다.</div>;
  }

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const domain = viewDomain ?? fullDomain;
  const { minX: viewMinX, maxX: viewMaxX, minY: viewMinY, maxY: viewMaxY } = domain;
  const xScale = (value) => padding.left + ((value - viewMinX) / Math.max(1, viewMaxX - viewMinX)) * plotWidth;
  const yScale = (value) => padding.top + plotHeight - ((value - viewMinY) / Math.max(1, viewMaxY - viewMinY)) * plotHeight;
  const xInvert = (value) => viewMinX + ((value - padding.left) / plotWidth) * Math.max(1, viewMaxX - viewMinX);
  const yInvert = (value) => viewMaxY - ((value - padding.top) / plotHeight) * Math.max(1, viewMaxY - viewMinY);
  const clampX = (value) => Math.min(width - padding.right, Math.max(padding.left, value));
  const clampY = (value) => Math.min(height - padding.bottom, Math.max(padding.top, value));
  const domainZoom = Math.max(1, (fullDomain.maxX - fullDomain.minX) / Math.max(1, viewMaxX - viewMinX));
  const isVisible = (point) => point.x >= viewMinX && point.x <= viewMaxX && point.y >= viewMinY && point.y <= viewMaxY;
  const xTicks = [viewMinX, viewMinX + (viewMaxX - viewMinX) / 2, viewMaxX];
  const yTicks = [viewMinY, viewMinY + (viewMaxY - viewMinY) / 2, viewMaxY];
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
  const handleMouseDown = (event) => {
    const point = getSvgPoint(event);
    setDragRange({ startX: point.x, startY: point.y, endX: point.x, endY: point.y });
  };
  const handleMouseMove = (event) => {
    if (!dragRange) return;
    const point = getSvgPoint(event);
    setDragRange((current) => current && { ...current, endX: point.x, endY: point.y });
  };
  const handleMouseUp = () => {
    if (!dragRange) return;
    const selectedWidth = Math.abs(dragRange.endX - dragRange.startX);
    const selectedHeight = Math.abs(dragRange.endY - dragRange.startY);

    if (selectedWidth >= 8 && selectedHeight >= 8) {
      const selected = {
        minX: xInvert(Math.min(dragRange.startX, dragRange.endX)),
        maxX: xInvert(Math.max(dragRange.startX, dragRange.endX)),
        minY: yInvert(Math.max(dragRange.startY, dragRange.endY)),
        maxY: yInvert(Math.min(dragRange.startY, dragRange.endY)),
      };

      if (mode === 'in') {
        setViewDomain(clampDomain(selected));
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

  return (
    <div className="chartCanvas">
      <div className="chartControls" aria-label="차트 확대 축소">
        <button className={mode === 'in' ? 'active' : ''} onClick={() => setMode('in')}>영역 확대</button>
        <button className={mode === 'out' ? 'active' : ''} onClick={() => setMode('out')}>영역 축소</button>
        <button onClick={() => setViewDomain(null)}>초기화</button>
        <span>{domainZoom.toFixed(1)}x</span>
      </div>
      <svg
        className="scatterChart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="eqp 시계열 차트"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setDragRange(null)}
      >
        <clipPath id={clipId}>
          <rect x={padding.left} y={padding.top} width={plotWidth} height={plotHeight} />
        </clipPath>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line className="gridLine" x1={padding.left} x2={width - padding.right} y1={yScale(tick)} y2={yScale(tick)} />
            <text className="axisText" x={padding.left - 8} y={yScale(tick) + 4} textAnchor="end">
              {tick.toFixed(2)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text key={tick} className="axisText" x={xScale(tick)} y={height - 17} textAnchor="middle">
            {formatShortDate(tick, points)}
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
          {allPoints
            .map((point) => ({ ...point, x: toTime(point.tkout_time, point), y: toNumber(point.fab_value) }))
            .filter((point) => point.x !== null && point.y !== null && isVisible(point))
            .map((point, index) => (
              <circle key={`all-${index}`} className="allPoint" cx={xScale(point.x)} cy={yScale(point.y)} r="2.6">
                <title>{getPointLabel(point, eqpId)}</title>
              </circle>
            ))}
          {failPoints
            .map((point) => ({ ...point, x: toTime(point.tkout_time, point), y: toNumber(point.fab_value) }))
            .filter((point) => point.x !== null && point.y !== null && isVisible(point))
            .map((point, index) => (
              <circle
                key={`fail-${index}`}
                className={point.final_decision === 'OK' ? 'okPoint' : 'failPoint'}
                cx={xScale(point.x)}
                cy={yScale(point.y)}
                r="4.7"
              >
                <title>{getPointLabel(point, eqpId)}</title>
              </circle>
            ))}
        </g>
        {selection && selection.width > 1 && selection.height > 1 && (
          <rect className="zoomSelection" x={selection.x} y={selection.y} width={selection.width} height={selection.height} />
        )}
      </svg>
    </div>
  );
}

function EquipmentChart({ row, eqpId }) {
  const paths = getChartPaths(row, eqpId);
  const [chartState, setChartState] = useState({ loading: true, error: '', data: null });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      mainStep: row.mainStepPath ?? row.mainStep,
      chartMetStep: getChartMetStep(row),
      eqpId,
    });

    setChartState({ loading: true, error: '', data: null });
    fetchJson(`/api/chart?${params.toString()}`, { signal: controller.signal })
      .then((payload) => setChartState({ loading: false, error: '', data: payload }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setChartState({ loading: false, error: error.message, data: error.payload ?? null });
      });

    return () => controller.abort();
  }, [eqpId, row]);

  return (
    <div className="chartShell">
      <div className="chartTitle">
        <div>
          <strong>{eqpId}</strong>
          <span>
            {row.mainStep} / {getChartMetStep(row)}
          </span>
        </div>
        <span>{chartState.loading ? 'loading' : chartState.error ? 'read failed' : `date ${chartState.data.latestDate}`}</span>
      </div>
      {chartState.loading ? (
        <div className="emptyChartBody">
          <p>차트 parquet 파일을 읽고 있습니다.</p>
        </div>
      ) : chartState.error ? (
        <div className="emptyChartBody">
          <p>{chartState.error}</p>
          {chartState.data?.diagnostics?.resolvedPaths?.attempts && (
            <div className="pathList">
              {(chartState.data.diagnostics.resolvedPaths.attempts.mainDirs ?? []).slice(0, 3).map((path) => (
                <code key={path}>{path}</code>
              ))}
              {(chartState.data.diagnostics.resolvedPaths.attempts.metDirs ?? []).slice(0, 3).map((path) => (
                <code key={path}>{path}</code>
              ))}
            </div>
          )}
          <div className="pathList">
            <code>{paths.all}</code>
            <code>{paths.fail}</code>
            <code>{paths.pm}</code>
          </div>
        </div>
      ) : (
        <>
          <ScatterChart
            allPoints={chartState.data.allPoints ?? []}
            failPoints={chartState.data.failPoints ?? []}
            pmEvents={chartState.data.pmEvents ?? []}
            eqpId={eqpId}
          />
          <div className="chartMeta">
            <code>{chartState.data.paths.all}</code>
            <code>{chartState.data.paths.fail}</code>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyChartState({ selectedRow }) {
  const paths = selectedRow ? getChartPaths(selectedRow) : null;

  return (
    <div className="chartShell emptyChart">
      <div className="chartTitle">
        <div>
          <strong>eqp별 Chart</strong>
          <span>{selectedRow ? `${selectedRow.mainStep} / ${getChartMetStep(selectedRow)}` : 'met_step 선택 필요'}</span>
        </div>
        <span>no mock data</span>
      </div>
      <div className="emptyChartBody">
        <p>
          {selectedRow
            ? '선택한 met_step에 연결된 eqp_id 목록이 확인되면 eqp별 차트를 그립니다.'
            : '좌측에서 main_step을 펼친 뒤 met_step을 선택하면 eqp별 차트 영역이 표시됩니다.'}
        </p>
        <div className="pathList">
          {(paths ? [paths.all, paths.fail, paths.pm] : DATA_SOURCES.map((source) => source.path)).map((path) => (
            <code key={path}>{path}</code>
          ))}
        </div>
      </div>
    </div>
  );
}

function DataSourceTable({ sources, diagnostics }) {
  return (
    <div className="tableShell compact">
      <table>
        <thead>
          <tr>
            <th>파일</th>
            <th>원본 경로</th>
            <th>필수 컬럼</th>
            <th>읽은 행</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {DATA_SOURCES.map((source) => {
            const status = sources.find((item) => item.key === source.key);
            return (
            <tr key={source.key}>
              <td>
                <strong>{source.label}</strong>
              </td>
              <td>
                <code>{source.path}</code>
              </td>
              <td>{source.requiredColumns.join(', ')}</td>
              <td>{Number(diagnostics?.inputRows?.[source.key] ?? 0).toLocaleString()}</td>
              <td>
                <span className={status?.exists && status?.readable ? 'readOk' : 'readFail'}>
                  {status?.exists && status?.readable ? '읽기 가능' : status?.exists ? '권한 확인 필요' : '파일 없음'}
                </span>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [loadState, setLoadState] = useState(EMPTY_LOAD_STATE);
  const rows = loadState.rows;
  const sdwtOptions = useMemo(() => buildSdwtOptions(rows), [rows]);
  const [selectedSdwt, setSelectedSdwt] = useState('ALL');
  const filteredRows = useMemo(() => filterRowsBySdwt(rows, selectedSdwt), [rows, selectedSdwt]);
  const mainStepGroups = useMemo(() => groupRowsByMainStep(filteredRows), [filteredRows]);
  const [selectedMetStep, setSelectedMetStep] = useState(null);

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
    const firstMetStep = mainStepGroups[0]?.metSteps[0] ?? null;
    setSelectedMetStep((current) => {
      if (current && mainStepGroups.some((group) => group.metSteps.some((row) => row.key === current.key))) return current;
      return firstMetStep;
    });
  }, [mainStepGroups]);

  const selectedEqpIds = selectedMetStep?.eqpIds ?? [];
  const metStepCount = mainStepGroups.reduce((sum, group) => sum + group.metSteps.length, 0);
  const eqpCount = filteredRows.reduce((sum, row) => sum + (row.eqpIds?.length ?? 0), 0);

  return (
    <main className="app">
      <header className="topBar">
        <div>
          <p className="eyebrow">P3D Defect Spider</p>
          <h1>스텝별 시계열 이상 트렌드 감지</h1>
        </div>
        <div className="summaryPills">
          <span>감지 라인 {CONFIG.lineName}</span>
          <span>선택 라인 {CONFIG.selectLine}</span>
          <span>Device {CONFIG.device}</span>
          <span>SDWT {selectedSdwt}</span>
        </div>
      </header>

      <SourceStatusBanner
        loading={loadState.loading}
        error={loadState.error}
        sources={loadState.sources}
        diagnostics={loadState.diagnostics}
      />

      <SdwtSelector options={sdwtOptions} selectedSdwt={selectedSdwt} onSelect={setSelectedSdwt} disabled={rows.length === 0} />

      <section className="workspace">
        <MainStepTree
          groups={mainStepGroups}
          selectedMetStepKey={selectedMetStep?.key}
          onSelectMetStep={setSelectedMetStep}
          loading={loadState.loading}
          error={loadState.error}
          diagnostics={loadState.diagnostics}
        />

        <section className="detailPanel">
          <div className="detailHeader">
            <div>
              <p className="eyebrow">Equipment Charts</p>
              <h2>{selectedMetStep ? `${selectedMetStep.mainStep} / ${getChartMetStep(selectedMetStep)}` : CONFIG.lineName}</h2>
            </div>
            <div className="statusChip">{loadState.error ? '파일 읽기 실패' : loadState.loading ? '파일 읽는 중' : '실제 파일 기반'}</div>
          </div>

          <div className="metricsGrid">
            <Metric label="메인 스탭" value={mainStepGroups.length.toLocaleString()} />
            <Metric label="MET 스탭" value={metStepCount.toLocaleString()} />
            <Metric label="감지 Chamber" value={eqpCount.toLocaleString()} />
            <Metric label="읽기 가능 소스" value={`${loadState.sources.filter((source) => source.exists && source.readable).length}/${DATA_SOURCES.length}`} />
          </div>

          <div className="chartGrid">
            {selectedMetStep && selectedEqpIds.length > 0 ? (
              selectedEqpIds.map((eqpId) => <EquipmentChart key={eqpId} row={selectedMetStep} eqpId={eqpId} />)
            ) : (
              <EmptyChartState selectedRow={selectedMetStep} />
            )}
          </div>

          <DataSourceTable sources={loadState.sources} diagnostics={loadState.diagnostics} />
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

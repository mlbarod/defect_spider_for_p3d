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

function toTime(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function formatShortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:00`;
}

function ScatterChart({ allPoints, failPoints, pmEvents }) {
  const width = 720;
  const height = 278;
  const padding = { left: 54, right: 18, top: 24, bottom: 42 };
  const points = [...allPoints, ...failPoints]
    .map((point) => ({ ...point, x: toTime(point.tkout_time), y: toNumber(point.fab_value) }))
    .filter((point) => point.x !== null && point.y !== null);

  if (points.length === 0) {
    return <div className="emptyMiniState">차트 parquet에서 tkout_time/fab_value 데이터를 찾지 못했습니다.</div>;
  }

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const yPad = Math.max(1, (maxY - minY) * 0.12);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xScale = (value) => padding.left + ((value - minX) / Math.max(1, maxX - minX)) * plotWidth;
  const yScale = (value) => padding.top + plotHeight - ((value - (minY - yPad)) / Math.max(1, maxY - minY + yPad * 2)) * plotHeight;
  const xTicks = [minX, minX + (maxX - minX) / 2, maxX];
  const yTicks = [minY, minY + (maxY - minY) / 2, maxY];

  return (
    <svg className="scatterChart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="eqp 시계열 차트">
      {yTicks.map((tick) => (
        <g key={tick}>
          <line className="gridLine" x1={padding.left} x2={width - padding.right} y1={yScale(tick)} y2={yScale(tick)} />
          <text className="axisText" x={padding.left - 8} y={yScale(tick) + 4} textAnchor="end">
            {tick.toFixed(2)}
          </text>
        </g>
      ))}
      {xTicks.map((tick) => (
        <text key={tick} className="axisText" x={xScale(tick)} y={height - 14} textAnchor="middle">
          {formatShortDate(tick)}
        </text>
      ))}
      <line className="axisLine" x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} />
      <line className="axisLine" x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} />
      {pmEvents
        .map((event) => ({ ...event, x: toTime(event.inprg_dt) }))
        .filter((event) => event.x !== null && event.x >= minX && event.x <= maxX)
        .map((event, index) => (
          <g key={`${event.inprg_dt}-${index}`}>
            <line className="pmLine" x1={xScale(event.x)} x2={xScale(event.x)} y1={padding.top} y2={height - padding.bottom} />
            <text className="pmText" x={xScale(event.x) + 4} y={padding.top + 12}>
              {event.work_type}
            </text>
          </g>
        ))}
      {allPoints
        .map((point) => ({ ...point, x: toTime(point.tkout_time), y: toNumber(point.fab_value) }))
        .filter((point) => point.x !== null && point.y !== null)
        .map((point, index) => (
          <circle key={`all-${index}`} className="allPoint" cx={xScale(point.x)} cy={yScale(point.y)} r="2.2" />
        ))}
      {failPoints
        .map((point) => ({ ...point, x: toTime(point.tkout_time), y: toNumber(point.fab_value) }))
        .filter((point) => point.x !== null && point.y !== null)
        .map((point, index) => (
          <circle
            key={`fail-${index}`}
            className={point.final_decision === 'OK' ? 'okPoint' : 'failPoint'}
            cx={xScale(point.x)}
            cy={yScale(point.y)}
            r="4.2"
          >
            <title>{`${point.lot_wf ?? ''} ${point.tkout_time ?? ''} ${point.eqp_ch ?? ''}`}</title>
          </circle>
        ))}
    </svg>
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

          <div className={`chartGrid ${selectedEqpIds.length <= 1 ? 'single' : ''}`}>
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

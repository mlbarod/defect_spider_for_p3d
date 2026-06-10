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

// Browser-only React cannot read the parquet/txt files under /appdata directly.
// Keep this empty until a file/API loader supplies rows parsed from temp.py's sources.
const STEP_ROWS = [];

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

function getChartMetStep(row) {
  const { metStepNo, metItem } = getMetStepDisplay(row.metStep);
  const metStep = metItem ? `${metStepNo}_${metItem}` : metStepNo;

  return isMainLine ? `${metStep}_main` : metStep;
}

function getChartPaths(row, eqpId = '{eqp_id}') {
  const chartMetStep = getChartMetStep(row);
  const base = `${folderPath}/${row.mainStep}/${chartMetStep}/{latestDate}`;

  return {
    eqpId,
    all: `${base}/${isMainLine ? 'main_all' : 'all'}_${row.mainStep}.parquet`,
    fail: `${base}/${isMainLine ? 'main_fail' : 'fail'}_${row.mainStep}.parquet`,
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

function MainStepTree({ groups, selectedMetStepKey, onSelectMetStep }) {
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
          <span>원본 파일 확인 전에는 임의 데이터를 표시하지 않습니다.</span>
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

function ChartPlaceholder({ row, eqpId }) {
  const paths = getChartPaths(row, eqpId);

  return (
    <div className="chartShell emptyChart">
      <div className="chartTitle">
        <div>
          <strong>{eqpId}</strong>
          <span>
            {row.mainStep} / {getChartMetStep(row)}
          </span>
        </div>
        <span>source path</span>
      </div>
      <div className="emptyChartBody">
        <p>선택한 met_step의 eqp별 차트가 이 위치에 그려집니다. 현재는 원본 parquet를 확인할 수 없어 경로만 표시합니다.</p>
        <div className="pathList">
          <code>{paths.all}</code>
          <code>{paths.fail}</code>
          <code>{paths.pm}</code>
        </div>
      </div>
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

function DataSourceTable() {
  return (
    <div className="tableShell compact">
      <table>
        <thead>
          <tr>
            <th>파일</th>
            <th>원본 경로</th>
            <th>필수 컬럼</th>
          </tr>
        </thead>
        <tbody>
          {DATA_SOURCES.map((source) => (
            <tr key={source.key}>
              <td>
                <strong>{source.label}</strong>
              </td>
              <td>
                <code>{source.path}</code>
              </td>
              <td>{source.requiredColumns.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const rows = STEP_ROWS;
  const sdwtOptions = useMemo(() => buildSdwtOptions(rows), [rows]);
  const [selectedSdwt, setSelectedSdwt] = useState('ALL');
  const filteredRows = useMemo(() => filterRowsBySdwt(rows, selectedSdwt), [rows, selectedSdwt]);
  const mainStepGroups = useMemo(() => groupRowsByMainStep(filteredRows), [filteredRows]);
  const [selectedMetStep, setSelectedMetStep] = useState(null);

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

      <SdwtSelector options={sdwtOptions} selectedSdwt={selectedSdwt} onSelect={setSelectedSdwt} disabled={rows.length === 0} />

      <section className="workspace">
        <MainStepTree groups={mainStepGroups} selectedMetStepKey={selectedMetStep?.key} onSelectMetStep={setSelectedMetStep} />

        <section className="detailPanel">
          <div className="detailHeader">
            <div>
              <p className="eyebrow">Equipment Charts</p>
              <h2>{selectedMetStep ? `${selectedMetStep.mainStep} / ${getChartMetStep(selectedMetStep)}` : CONFIG.lineName}</h2>
            </div>
            <div className="statusChip">파일 미확인 시 경로 표시</div>
          </div>

          <div className="metricsGrid">
            <Metric label="메인 스탭" value={mainStepGroups.length.toLocaleString()} />
            <Metric label="MET 스탭" value={metStepCount.toLocaleString()} />
            <Metric label="감지 Chamber" value={eqpCount.toLocaleString()} />
            <Metric label="데이터 소스" value={DATA_SOURCES[1].path} />
          </div>

          <div className={`chartGrid ${selectedEqpIds.length <= 1 ? 'single' : ''}`}>
            {selectedMetStep && selectedEqpIds.length > 0 ? (
              selectedEqpIds.map((eqpId) => <ChartPlaceholder key={eqpId} row={selectedMetStep} eqpId={eqpId} />)
            ) : (
              <EmptyChartState selectedRow={selectedMetStep} />
            )}
          </div>

          <DataSourceTable />
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

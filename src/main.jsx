import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const MAIN_STEPS = [
  {
    name: 'ETCH',
    subSteps: ['ETCH-012-A', 'ETCH-012-B', 'ETCH-012-C', 'ETCH-012-D'],
  },
  {
    name: 'PHOTO',
    subSteps: ['PHOTO-027-A', 'PHOTO-027-B', 'PHOTO-027-C', 'PHOTO-027-D'],
  },
  {
    name: 'CVD',
    subSteps: ['CVD-018-A', 'CVD-018-B', 'CVD-018-C', 'CVD-018-D'],
  },
  {
    name: 'CMP',
    subSteps: ['CMP-004-A', 'CMP-004-B', 'CMP-004-C', 'CMP-004-D'],
  },
];

const EQUIPMENT_UNITS = ['EQ-01', 'EQ-02', 'EQ-03', 'EQ-04', 'EQ-05', 'EQ-06'];

const TREND_LABELS = {
  stable: '정상',
  upward: '상승 추세',
  downward: '하락 추세',
  volatile: '변동성 급증',
  shift: '레벨 시프트',
};

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function generateEquipmentSeries(mainStep, subStep, equipment, mainIndex, subIndex, equipmentIndex) {
  const index = mainIndex * 24 + subIndex * 6 + equipmentIndex;
  const random = seededRandom(7801 + index * 97);
  const start = new Date('2026-05-01T00:00:00+09:00').getTime();
  const points = [];
  const anomalyPatterns = ['upward', 'volatile', 'shift', 'downward'];
  const hasAnomaly = (mainIndex + subIndex + equipmentIndex) % 3 !== 1;
  const pattern = hasAnomaly ? anomalyPatterns[(mainIndex + subIndex + equipmentIndex) % anomalyPatterns.length] : 'stable';
  const base = 500 + mainIndex * 72 + subIndex * 24 + equipmentIndex * 8;

  for (let i = 0; i < 180; i += 1) {
    const noise = Math.round((random() - 0.5) * 42);
    let value = base + noise;

    if (pattern === 'upward') value += Math.round(i * 0.95);
    if (pattern === 'downward') value -= Math.round(i * 0.82);
    if (pattern === 'volatile') value += Math.round((random() - 0.5) * (i > 90 ? 170 : 58));
    if (pattern === 'shift') value += i > 92 ? 135 + Math.round((random() - 0.5) * 34) : 0;

    points.push({
      id: `${subStep}-${equipment}-${i}`,
      mainStep,
      subStep,
      equipment,
      value,
      timestamp: new Date(start + i * 1000 * 60 * 72 + index * 1000 * 60 * 9).toISOString(),
      lotId: `LOT-${String(index + 1).padStart(2, '0')}-${String(i + 1).padStart(3, '0')}`,
    });
  }

  return points;
}

function createDataFrameLikeRows() {
  return MAIN_STEPS.flatMap((mainStep, mainIndex) =>
    mainStep.subSteps.flatMap((subStep, subIndex) =>
      EQUIPMENT_UNITS.flatMap((equipment, equipmentIndex) =>
        generateEquipmentSeries(mainStep.name, subStep, equipment, mainIndex, subIndex, equipmentIndex),
      ),
    ),
  );
}

function linearRegression(points) {
  const n = points.length;
  const meanX = (n - 1) / 2;
  const meanY = points.reduce((sum, point) => sum + point.value, 0) / n;
  let numerator = 0;
  let denominator = 0;

  points.forEach((point, index) => {
    numerator += (index - meanX) * (point.value - meanY);
    denominator += (index - meanX) ** 2;
  });

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const residuals = points.map((point, index) => point.value - (meanY + slope * (index - meanX)));
  const residualStd = Math.sqrt(residuals.reduce((sum, item) => sum + item ** 2, 0) / n);

  return { slope, residualStd, meanY };
}

function detectAnomalousSteps(rows) {
  const grouped = Map.groupBy(rows, (row) => `${row.mainStep}::${row.subStep}::${row.equipment}`);

  return Array.from(grouped.entries())
    .map(([, points]) => {
      const ordered = points.toSorted((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const { mainStep, subStep, equipment } = ordered[0];
      const { slope, residualStd, meanY } = linearRegression(ordered);
      const firstHalf = ordered.slice(0, Math.floor(ordered.length / 2));
      const secondHalf = ordered.slice(Math.floor(ordered.length / 2));
      const firstMean = firstHalf.reduce((sum, point) => sum + point.value, 0) / firstHalf.length;
      const secondMean = secondHalf.reduce((sum, point) => sum + point.value, 0) / secondHalf.length;
      const shift = secondMean - firstMean;
      const volatilityRatio = residualStd / Math.max(1, Math.abs(meanY));
      const trendScore = Math.abs(slope) * 100;
      const shiftScore = Math.abs(shift) * 0.72;
      const volatilityScore = volatilityRatio * 950;
      const score = Math.min(100, Math.round(Math.max(trendScore, shiftScore, volatilityScore)));

      let trendType = 'stable';
      if (Math.abs(shift) > 75) trendType = 'shift';
      if (Math.abs(slope) > 0.48) trendType = slope > 0 ? 'upward' : 'downward';
      if (volatilityRatio > 0.08) trendType = 'volatile';

      return {
        mainStep,
        subStep,
        equipment,
        points: ordered,
        pointCount: ordered.length,
        score,
        slope,
        shift,
        volatilityRatio,
        trendType,
        isAnomaly: score >= 48,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function groupByStepHierarchy(analyses) {
  return MAIN_STEPS.map((mainStep) => {
    const subGroups = mainStep.subSteps
      .map((subStep) => {
        const equipmentAnalyses = analyses
          .filter((analysis) => analysis.mainStep === mainStep.name && analysis.subStep === subStep && analysis.isAnomaly)
          .sort((a, b) => EQUIPMENT_UNITS.indexOf(a.equipment) - EQUIPMENT_UNITS.indexOf(b.equipment));
        const maxScore = equipmentAnalyses.reduce((max, analysis) => Math.max(max, analysis.score), 0);

        return {
          mainStep: mainStep.name,
          subStep,
          equipmentAnalyses,
          maxScore,
        };
      })
      .filter((group) => group.equipmentAnalyses.length > 0);
    const maxScore = subGroups.reduce((max, group) => Math.max(max, group.maxScore), 0);
    const anomalyEquipmentCount = subGroups.reduce((sum, group) => sum + group.equipmentAnalyses.length, 0);

    return {
      mainStep: mainStep.name,
      subGroups,
      anomalyEquipmentCount,
      maxScore,
    };
  }).filter((group) => group.subGroups.length > 0);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function ScatterChart({ stepAnalysis }) {
  const [hovered, setHovered] = useState(null);
  const width = 560;
  const height = 300;
  const padding = { top: 22, right: 24, bottom: 42, left: 54 };
  const points = stepAnalysis.points;
  const minValue = Math.min(...points.map((point) => point.value));
  const maxValue = Math.max(...points.map((point) => point.value));
  const yPadding = Math.max(20, (maxValue - minValue) * 0.12);
  const yMin = minValue - yPadding;
  const yMax = maxValue + yPadding;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const xScale = (index) => padding.left + (index / (points.length - 1)) * innerWidth;
  const yScale = (value) => padding.top + (1 - (value - yMin) / (yMax - yMin)) * innerHeight;
  const trendStartY = yScale(stepAnalysis.points[0].value);
  const trendEndY = yScale(stepAnalysis.points[0].value + stepAnalysis.slope * (points.length - 1));
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) / 4) * index);
  const xTicks = [0, Math.floor(points.length / 3), Math.floor((points.length * 2) / 3), points.length - 1];

  return (
    <div className="chartShell">
      <div className="chartTitle">
        <div>
          <strong>{stepAnalysis.equipment}</strong>
          <span>
            {stepAnalysis.subStep} · {TREND_LABELS[stepAnalysis.trendType]}
          </span>
        </div>
        <span>score {stepAnalysis.score}</span>
      </div>
      <svg className="scatterChart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${stepAnalysis.subStep} 스캐터 차트`}>
        <rect x="0" y="0" width={width} height={height} rx="0" fill="transparent" />
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={padding.left} x2={width - padding.right} y1={yScale(tick)} y2={yScale(tick)} className="gridLine" />
            <text x={padding.left - 12} y={yScale(tick) + 4} className="axisText" textAnchor="end">
              {Math.round(tick)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text key={tick} x={xScale(tick)} y={height - 14} className="axisText" textAnchor="middle">
            {formatDate(points[tick].timestamp)}
          </text>
        ))}
        <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} className="axisLine" />
        <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} className="axisLine" />
        <line
          x1={xScale(0)}
          y1={trendStartY}
          x2={xScale(points.length - 1)}
          y2={trendEndY}
          className="trendLine"
        />
        {points.map((point, index) => (
          <circle
            key={point.id}
            cx={xScale(index)}
            cy={yScale(point.value)}
            r={hovered?.id === point.id ? 5.5 : 3.4}
            className="dataPoint"
            onMouseEnter={() => setHovered(point)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
      </svg>
      {hovered && (
        <div className="tooltipPanel">
          <strong>{hovered.lotId}</strong>
          <span>{formatDate(hovered.timestamp)}</span>
          <span>{hovered.value.toLocaleString()} counts</span>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StepTree({ groups, selectedSubStepKey, onSelect }) {
  const selectedMainStep = selectedSubStepKey.split('::')[0];
  const [openSteps, setOpenSteps] = useState(() => new Set([selectedMainStep]));

  const toggleMainStep = (mainStep) => {
    setOpenSteps((current) => {
      const next = new Set(current);

      if (next.has(mainStep)) {
        next.delete(mainStep);
      } else {
        next.add(mainStep);
      }

      return next;
    });
  };

  return (
    <aside className="sidePanel" aria-label="이상 감지 스텝 선택">
      <div className="sideHeader">
        <div>
          <p className="eyebrow">Detected Step Tree</p>
          <h2>이상 트렌드</h2>
        </div>
        <span className="countBadge">{groups.length}</span>
      </div>
      <div className="mainStepList">
        {groups.map((group) => {
          const isOpen = openSteps.has(group.mainStep);
          const hasSelectedSubStep = group.subGroups.some((subGroup) => `${subGroup.mainStep}::${subGroup.subStep}` === selectedSubStepKey);

          return (
            <section key={group.mainStep} className={`mainStepGroup ${hasSelectedSubStep ? 'selected' : ''}`}>
              <button
                className="mainStepToggle"
                onClick={() => toggleMainStep(group.mainStep)}
                aria-expanded={isOpen}
                aria-controls={`substeps-${group.mainStep}`}
              >
                <span className={`chevron ${isOpen ? 'open' : ''}`} aria-hidden="true">
                  ▸
                </span>
                <span className="mainStepTitle">
                  <span className="stepName">{group.mainStep}</span>
                  <span className="stepTrend">{group.anomalyEquipmentCount} equipment</span>
                </span>
                <span className="mainScore">score {group.maxScore}</span>
              </button>
              <span className="scoreBar" aria-hidden="true">
                <span style={{ width: `${group.maxScore}%` }} />
              </span>
              {isOpen && (
                <div className="subStepButtons" id={`substeps-${group.mainStep}`}>
                  {group.subGroups.map((subGroup) => {
                    const key = `${subGroup.mainStep}::${subGroup.subStep}`;

                    return (
                      <button
                        key={subGroup.subStep}
                        className={`subStepButton ${selectedSubStepKey === key ? 'active' : ''}`}
                        onClick={() => onSelect(key)}
                      >
                        <span>{subGroup.subStep}</span>
                        <strong>{subGroup.equipmentAnalyses.length}호기</strong>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function App() {
  const rows = useMemo(() => createDataFrameLikeRows(), []);
  const analyses = useMemo(() => detectAnomalousSteps(rows), [rows]);
  const anomalousSteps = analyses.filter((analysis) => analysis.isAnomaly);
  const stepGroups = useMemo(() => groupByStepHierarchy(analyses), [analyses]);
  const firstSubStepKey = `${stepGroups[0]?.mainStep}::${stepGroups[0]?.subGroups[0]?.subStep}`;
  const [selectedSubStepKey, setSelectedSubStepKey] = useState(firstSubStepKey);
  const selectedSubGroup =
    stepGroups.flatMap((group) => group.subGroups).find((group) => `${group.mainStep}::${group.subStep}` === selectedSubStepKey) ??
    stepGroups[0].subGroups[0];
  const selectedEquipmentAnalyses = selectedSubGroup.equipmentAnalyses.slice(0, 4);
  const maxScore = selectedEquipmentAnalyses.reduce((max, analysis) => Math.max(max, analysis.score), 0);

  return (
    <main className="app">
      <header className="topBar">
        <div>
          <p className="eyebrow">P3D Defect Spider</p>
          <h1>스텝별 시계열 이상 트렌드 감지</h1>
        </div>
        <div className="summaryPills">
          <span>메인 스텝 {MAIN_STEPS.length}</span>
          <span>하위 스텝 {MAIN_STEPS.reduce((sum, item) => sum + item.subSteps.length, 0)}</span>
          <span>설비 호기 {analyses.length}</span>
          <span>이상 호기 {anomalousSteps.length}</span>
          <span>데이터 {rows.length.toLocaleString()}</span>
        </div>
      </header>

      <section className="workspace">
        <StepTree groups={stepGroups} selectedSubStepKey={selectedSubStepKey} onSelect={setSelectedSubStepKey} />

        <section className="detailPanel">
          <div className="detailHeader">
            <div>
              <p className="eyebrow">Equipment Anomaly Charts</p>
              <h2>
                {selectedSubGroup.mainStep} / {selectedSubGroup.subStep}
              </h2>
            </div>
            <div className="statusChip">Max anomaly score {maxScore}</div>
          </div>

          <div className="metricsGrid">
            <Metric label="이상 설비 호기" value={selectedEquipmentAnalyses.length.toLocaleString()} />
            <Metric label="샘플 합계" value={selectedEquipmentAnalyses.reduce((sum, item) => sum + item.pointCount, 0).toLocaleString()} />
            <Metric label="최대 점수" value={maxScore.toLocaleString()} />
            <Metric
              label="평균 변동성"
              value={`${((selectedEquipmentAnalyses.reduce((sum, item) => sum + item.volatilityRatio, 0) / selectedEquipmentAnalyses.length) * 100).toFixed(1)}%`}
            />
          </div>

          <div className="chartGrid">
            {selectedEquipmentAnalyses.map((analysis) => (
              <ScatterChart key={analysis.equipment} stepAnalysis={analysis} />
            ))}
          </div>
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

# defect_spider_for_p3d

## Data Sources

웹 화면에서는 파일 경로를 표시하지 않는다. 파일 경로, 참조 컬럼, chart parquet 경로 규칙이 변경되면 이 README를 함께 업데이트한다.

| 파일 | 원본 경로 | 필수/참조 컬럼 |
| --- | --- | --- |
| Measure SPEC | `/appdata/hadoop/code/eads/PFB3/D1c_measure_spec.parquet` | `step_seq`, `spec_high` |
| 중심치 이상 목록 | `/appdata/hadoop/code/eads/PFB3/D1c/main_fail_list.parquet` | `main_seq`, `met_seq`, `eqpid` |
| 산포 이상 목록 | `/appdata/hadoop/code/eads/PFB3/D1c/main_fail_list_std.parquet` | `main_seq`, `met_seq`, `eqpid` |
| MET 매핑 | `/appdata/hadoop/code/eads/PFB3/met.txt` | `device`, `main_step`, `met_step`, `step_desc`, `sdwt` |
| PM 이력 | `/appdata/abnormal_trend/pic/pm_code_info.parquet` | `asset`, `inprg_dt`, `work_type` |

## Chart Data

선택된 `main_step`, `met_step`, 최신 날짜 디렉터리를 기준으로 chart parquet을 읽는다.

| 용도 | 경로 규칙 | 참조 컬럼 |
| --- | --- | --- |
| main_all 배경 scatter | `/appdata/hadoop/code/eads/PFB3/D1c/{main_step}/{chart_met_step}/{latestDate}/main_all_{main_step}.parquet` | `tkout_time`, `fab_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqp_id`, `eqpid`, `process_id`, `item_id`, `final_decision` |
| main_fail 중심치 이상 scatter | `/appdata/hadoop/code/eads/PFB3/D1c/{main_step}/{chart_met_step}/{latestDate}/main_fail_{main_step}.parquet` | `tkout_time`, `fab_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqp_id`, `eqpid`, `process_id`, `item_id`, `final_decision` |
| main_fail_std 산포 이상 scatter | `/appdata/hadoop/code/eads/PFB3/D1c/{main_step}/{chart_met_step}/{latestDate}/main_fail_std_{main_step}.parquet` | `tkout_time`, `fab_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqp_id`, `eqpid`, `process_id`, `item_id`, `final_decision`, `std_result` |

`main_all`은 각 chart의 현재 `eqp_id`를 제외한 전체 데이터를 배경 scatter로 표시한다. `main_fail`과 `main_fail_std`는 chart별 `eqp_id`로 필터링하며, 중심치 이상은 `final_decision`, 산포 이상은 `std_result`가 `NG`인 점 또는 같은 `lot_id`와 `wafer_id`가 NG 식별자와 일치하는 점을 빨간색으로 표시한다. 초기 Y축 range는 각 step의 `main_all` `fab_value`에서 20/80 percentile 기반 IQR outlier를 제거한 뒤 `min - 2`, `max * 1.2`로 계산한다. 우측 legend는 `main_all.step_seq[0:2]` prefix와 `eqp_id`/`eqpid`/`eqp_ch` 설비 값을 기준으로 만들며, chart의 그룹핑된 설비는 빨간색, 나머지 설비는 회색으로 표시한다. 각 chart 하단의 NG 테이블은 `wafer_id`, `tkout_time`, `step_seq`, `eqp_id`, `lot_id`, `process_id`, `item_id`, `fab_value`를 표시한다.

# defect_spider_for_p3d

## Data Sources

웹 화면에서는 파일 경로를 표시하지 않는다. 파일 경로, 참조 컬럼, chart parquet 경로 규칙이 변경되면 이 README를 함께 업데이트한다.

| 파일 | 원본 경로 | 필수/참조 컬럼 |
| --- | --- | --- |
| Measure SPEC | `/appdata/hadoop/code/eads/PFB3/D1c_measure_spec.parquet` | `step_seq`, `spec_high` |
| 중심치 이상 목록 | `/appdata/hadoop/code/eads/PFB3/D1c/main_fail_list.parquet` | `main_seq`, `met_seq`, `eqpid` |
| 산포 이상 목록 | `/appdata/hadoop/code/eads/PFB3/D1c/main_fail_list_std.parquet` | `main_seq`, `met_seq`, `eqpid` |
| MET 매핑 | `/appdata/hadoop/code/eads/PFB3/met.txt` | `device`, `main_step`, `met_step`, `step_desc`, `sdwt` |
| FCC 스탭 MET 매핑 | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/met_fcc.txt` | `device`, `main_step`, `met_step`, `step_desc`, `sdwt` |
| FCC 중심치 이상 목록 | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/fail_list.parquet` | `main_seq`, `met_seq`, `eqpid` |
| FCC 산포 이상 목록 | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/fail_list_std.parquet` | `main_seq`, `met_seq`, `eqpch` |
| FCC 추가 MET 매핑 | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/met_fcc.txt` | `device`, `main_step`, `met_step`, `step_desc`, `sdwt` |
| FCC 추가 중심치 이상 목록 | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fail_list.parquet` | `main_seq`, `met_seq`, `eqpid` |
| PM 이력 | `/appdata/abnormal_trend/pic/pm_code_info.parquet` | `asset`, `inprg_dt`, `work_type` |

## Chart Data

선택된 `main_step`, `met_step`, 최신 날짜 디렉터리를 기준으로 chart parquet을 읽는다.

| 용도 | 경로 규칙 | 참조 컬럼 |
| --- | --- | --- |
| main_all 배경 scatter | `/appdata/hadoop/code/eads/PFB3/D1c/{main_step}/{chart_met_step}/{latestDate}/main_all_{main_step}.parquet` | `tkout_time`, `fab_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqp_id`, `eqpid`, `process_id`, `item_id`, `final_decision` |
| main_fail 중심치 이상 scatter | `/appdata/hadoop/code/eads/PFB3/D1c/{main_step}/{chart_met_step}/{latestDate}/main_fail_{main_step}.parquet` | `tkout_time`, `fab_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqp_id`, `eqpid`, `process_id`, `item_id`, `final_decision` |
| main_fail_std 산포 이상 scatter | `/appdata/hadoop/code/eads/PFB3/D1c/{main_step}/{chart_met_step}/{latestDate}/main_fail_std_{main_step}.parquet` | `tkout_time`, `fab_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqp_id`, `eqpid`, `process_id`, `item_id`, `final_decision`, `std_result` |
| FCC all 배경 scatter | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/U%{main_step}/{met_step}_{item_id}/{latestDate}/all_U%{main_step}.parquet` | `tkout_time`, `defect_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `process_id`, `item_id`, `final_decision` |
| FCC fail 중심치 이상 scatter | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/U%{main_step}/{met_step}_{item_id}/{latestDate}/fail_U%{main_step}.parquet` | `tkout_time`, `defect_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `process_id`, `item_id`, `final_decision` |
| FCC fail_std 산포 이상 scatter | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/U%{main_step}/{met_step}_{item_id}/{latestDate}/fail_std_U%{main_step}.parquet` | `tkout_time`, `defect_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `process_id`, `item_id`, `final_decision`, `std_result` |
| FCC 추가 all 배경 scatter | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/U%{main_step}/{met_step}_{item_id}/{latestDate}/all_U%{main_step}.parquet` | `tkout_time`, `defect_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqpid`, `process_id`, `item_id`, `final_decision` |
| FCC 추가 fail 중심치 이상 scatter | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/U%{main_step}/{met_step}_{item_id}/{latestDate}/fail_U%{main_step}.parquet` | `tkout_time`, `defect_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqpid`, `process_id`, `item_id`, `final_decision` |

`main_all`은 각 chart의 현재 `eqp_id`를 제외한 전체 데이터를 배경 scatter로 표시한다. `main_fail`과 `main_fail_std`는 chart별 `eqp_id`로 필터링하며, 중심치 이상은 `final_decision`, 산포 이상은 `std_result`가 있으면 `std_result`, 없으면 `final_decision`이 `NG`인 점 또는 같은 `lot_id`와 `wafer_id`가 NG 식별자와 일치하는 점을 빨간색으로 표시한다. 초기 Y축 range는 각 step의 `main_all` `fab_value`에서 10/90 percentile 기반 IQR outlier를 제거한 뒤 `min - 2`, `max * 1.2`로 계산한다. 우측 legend는 `main_all.step_seq[0:2]` prefix와 `eqp_id`/`eqpid`/`eqp_ch` 설비 값을 기준으로 만들며, chart의 그룹핑된 설비는 빨간색, 나머지 설비는 회색으로 표시한다. 각 chart 하단의 NG 테이블은 `wafer_id`, `tkout_time`, `step_seq`, `eqp_id`, `lot_id`, `process_id`, `item_id`, `fab_value`를 표시한다.

FCC chart의 기존 `main_step`은 FCC 스탭 MET 매핑 파일 값을 사용하며, `U%` prefix를 제거한 뒤 뒤의 여섯자리 step 값을 기준으로 `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step` 하위 경로를 만든다. FCC 추가 chart는 FCC 추가 MET 매핑 파일에서 `main_step`에 매핑된 `met_step`을 사용하고, FCC 추가 중심치 이상 목록 `met_seq`에서 `_` 뒤 `item_id`를 가져와 `/appdata/hadoop/code/eads/PFB3/D1c_fcc/U%{main_step}/{met_step}_{item_id}` 하위 추가 scatter 경로를 만든다. FCC 추가 이상감지는 FCC 중심치 이상 목록 `eqpid`와 FCC 추가 중심치 이상 목록 `eqpid`의 교집합 설비만 대상으로 하며, 교집합 설비를 클릭하면 기존 FCC all/fail 중심치 scatter chart와 FCC 추가 all/fail 중심치 scatter chart를 각각 그린다. FCC met step 버튼은 FCC 추가 중심치 이상 목록과 교집합 설비가 있는 항목을 먼저 표시한다.

좌측 FCC지수 연관 이상감지 목록은 기존 FCC 스탭 MET 매핑 파일(`/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/met_fcc.txt`)과 FCC 추가 MET 매핑 파일(`/appdata/hadoop/code/eads/PFB3/D1c_fcc/met_fcc.txt`) 기준으로 `main_step`과 하위 `met_step`을 구성한다. 기존 FCC 중심치/산포 이상 목록 또는 FCC 추가 중심치 이상 목록의 교집합 설비와 매칭되어 이상 설비가 있는 `main_step`/`met_step` 버튼만 표시한다.

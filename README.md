# defect_spider_for_p3d

## Data Sources

웹 화면에서는 원본 파일 경로와 읽기 상태를 표시한다. 파일 경로, 참조 컬럼, chart parquet 경로 규칙이 변경되면 이 README를 함께 업데이트한다.

| 파일 | 원본 경로 | 필수/참조 컬럼 |
| --- | --- | --- |
| Measure SPEC | `/appdata/hadoop/code/eads/PFB3/D1c_measure_spec.parquet` | `step_seq`, `spec_high` |
| 중심치 이상 목록 | `/appdata/hadoop/code/eads/PFB3/D1c/main_fail_list.parquet` | `main_seq`, `met_seq`, `eqpid` 또는 `eqpch` |
| 산포 이상 목록 | `/appdata/hadoop/code/eads/PFB3/D1c/main_fail_list_std.parquet` | `main_seq`, `met_seq`, `eqpid` 또는 `eqpch` |
| MET 매핑 | `/appdata/hadoop/code/eads/PFB3/met.txt` | `device`, `main_step`, `met_step`, `step_desc`, `sdwt` |
| FCC 스탭 MET 매핑 | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/met_fcc.txt` | `device`, `main_step`, `met_step`, `met_item`, `met_item2`, `draw_category`, `step_desc`, `sdwt` |
| FCC 중심치 이상 목록 | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/fail_list.parquet` | `main_seq`/`main_step`, `met_seq`/`met_step`, `eqpid` 또는 `eqpch` |
| FCC 추가 MET 매핑 | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/met_fcc.txt` | `device`, `main_step`, `met_step`, `step_desc`, `sdwt` |
| FCC 추가 중심치 이상 목록 | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fail_list.parquet` | `main_seq`, `met_seq`, `eqpid` 또는 `eqpch` |
| FCC 추가 산포 이상 목록 | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fail_list_std.parquet` | `main_seq`, `met_seq`, `eqpid` 또는 `eqpch` |
| FCC 이상시점 추가 이상 목록 | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_timefit/fail_fccdate_list.parquet` | `main_seq`, `met_seq`, `eqpid`, `fcc_step_seq` |
| 개별 챔버 이상감지 라인 매핑파일 | `/appdata/hadoop/code/eads/line_mapping.txt` | 탭 구분 txt 헤더 `line`, `line_code`, `device` |
| Defect MAP URL 설정 | `/appdata/hadoop/code/eads/config.json` | URL 템플릿 문자열 또는 `url`/`defectMapUrl`; `{}` placeholder 3개 |
| 개별챔버 MET 매핑 | `/appdata/hadoop/code/eads/{line_code}/met.txt` | `device`, `main_step`, `met_step`, `step_desc`, `sdwt` |
| 개별챔버 중심치 이상목록 | `/appdata/hadoop/code/eads/{line_code}/{device}/fail_list.parquet` | `main_seq`, `met_seq`, `eqpid` 또는 `eqpch` |
| 개별챔버 산포 이상목록 | `/appdata/hadoop/code/eads/{line_code}/{device}/fail_list_std.parquet` | `main_seq`, `met_seq`, `eqpid` 또는 `eqpch` |
| PM 이력 | `/appdata/abnormal_trend/pic/change_code_info.parquet` | `asset` 또는 `eqp_ch`/`eqpch`, `inprg_dt`, `work_type`, `description`, `url` |

## Chart Data

선택된 `main_step`, `met_step`, 최신 날짜 디렉터리를 기준으로 chart parquet을 읽는다.

| 용도 | 경로 규칙 | 참조 컬럼 |
| --- | --- | --- |
| main_all 배경 scatter | `/appdata/hadoop/code/eads/PFB3/D1c/{main_step}/{chart_met_step}/{latestDate}/main_all_{main_step}.parquet` | `tkout_time`, `fab_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqp_id`, `eqpid`, `process_id`, `item_id`, `ppid`, `ppid_right`, `final_decision` |
| main_fail 중심치 이상 scatter | `/appdata/hadoop/code/eads/PFB3/D1c/{main_step}/{chart_met_step}/{latestDate}/main_fail_{main_step}.parquet` | `tkout_time`, `fab_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqp_id`, `eqpid`, `process_id`, `item_id`, `final_decision` |
| main_fail_std 산포 이상 scatter | `/appdata/hadoop/code/eads/PFB3/D1c/{main_step}/{chart_met_step}/{latestDate}/main_fail_std_{main_step}.parquet` | `tkout_time`, `fab_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqp_id`, `eqpid`, `process_id`, `item_id`, `final_decision`, `std_result` |
| FCC all 배경 scatter | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/U%{main_step}/{met_step}_{item_id}/{latestDate}/all_U%{main_step}.parquet` | `tkout_time`, `defect_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `process_id`, `item_id`, `item_desc`, `ppid`, `ppid_right`, `final_decision` |
| FCC fail 중심치 이상 scatter | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/U%{main_step}/{met_step}_{item_id}/{latestDate}/fail_U%{main_step}.parquet` | `tkout_time`, `defect_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `process_id`, `item_id`, `final_decision` |
| FCC 추가 all 배경 scatter | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/U%{main_step}/{met_step}_{item_id}/{latestDate}/all_U%{main_step}.parquet` | `tkout_time`, `defect_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqpid`, `process_id`, `item_id`, `item_desc`, `ppid`, `ppid_right`, `final_decision` |
| FCC 추가 fail 중심치 이상 scatter | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/U%{main_step}/{met_step}_{item_id}/{latestDate}/fail_U%{main_step}.parquet` | `tkout_time`, `defect_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqpid`, `process_id`, `item_id`, `final_decision` |
| FCC 추가 fail_std 산포 이상 scatter | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/U%{main_step}/{met_step}_{item_id}/{latestDate}/fail_std_U%{main_step}.parquet` | `tkout_time`, `defect_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqpid`, `process_id`, `item_id`, `final_decision`, `std_result` |
| FCC 이상시점 all 배경 scatter | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_timefit/U%{main_seq}/{met_seq}/{latestDate}/all_fccdate_{eqpid}_U%{main_seq}.parquet` | `tkout_time`, `defect_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `process_id`, `item_id`, `item_desc`, `ppid`, `ppid_right`, `final_decision` |
| FCC 이상시점 fail 중심치 이상 scatter | `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_timefit/U%{main_seq}/{met_seq}/{latestDate}/fail_fccdate_{eqpid}_U%{main_seq}.parquet` | `tkout_time`, `defect_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `process_id`, `item_id`, `final_decision` |
| 개별챔버 all 배경 scatter | `/appdata/hadoop/code/eads/{line_code}/{device}/{main_step}/{met_step}_{item_id}/{latestDate}/all_{main_step}.parquet` | `tkout_time`, `fab_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqp_id`, `eqpid`, `process_id`, `item_id`, `item_desc`, `ppid`, `ppid_right`, `final_decision` |
| 개별챔버 fail 중심치 이상 scatter | `/appdata/hadoop/code/eads/{line_code}/{device}/{main_step}/{met_step}_{item_id}/{latestDate}/fail_{main_step}.parquet` | `tkout_time`, `fab_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqp_id`, `eqpid`, `process_id`, `item_id`, `final_decision` |
| 개별챔버 fail_std 산포 이상 scatter | `/appdata/hadoop/code/eads/{line_code}/{device}/{main_step}/{met_step}_{item_id}/{latestDate}/fail_std_{main_step}.parquet` | `tkout_time`, `fab_value`, `wafer_id`, `lot_id`, `lot_wf`, `step_seq`, `eqp_ch`, `eqp_id`, `eqpid`, `process_id`, `item_id`, `final_decision`, `std_result` |

`main_all`은 각 chart의 현재 `eqp_id`를 제외한 전체 데이터를 배경 scatter로 표시한다. `main_fail`과 `main_fail_std`는 chart별 `eqp_id`로 필터링하며, 중심치 이상은 `final_decision`, 산포 이상은 `std_result` 또는 `final_decision`이 `NG`인 점 또는 같은 `lot_id`와 `wafer_id`가 NG 식별자와 일치하는 점을 빨간색으로 표시한다. 초기 Y축 range는 각 step의 `main_all` `fab_value`에서 10/90 percentile 기반 IQR outlier를 제거하되, fail/fail_std scatter의 `final_decision`이 `NG`인 `fab_value`는 outlier 범위 밖이어도 포함한 뒤 `min - 2`, `max * 1.2`로 계산한다. 우측 legend는 `main_all.step_seq[0:2]` prefix와 `eqp_ch`/`eqpch` 표시값 기준으로 만들며, chart의 그룹핑된 설비는 빨간색, 나머지 설비는 회색으로 표시한다. dot tooltip은 `ppid` 컬럼을 `met_ppid`, `ppid_right` 컬럼을 `ppid`로 표시하되, all 배경 scatter 파일에 `ppid_right` 컬럼이 없으면 all 파일의 `ppid` 값을 tooltip의 `ppid`로 표시하고 `met_ppid`는 `-`로 표시한다. 전라인 챔버별 이상감지에서 P3D 라인을 선택하거나 P3D FCC지수 이상감지에서 FCC row를 분류/draw할 때 `eqpid`/`eqp_ch`의 숫자 토큰이 `35`로 시작하는 설비는 요약 목록과 chart scatter에서 제외한다. 단, FCC 이상시점 all/fail scatter는 `fail_fccdate_list.parquet`로 지정된 all/fail 파일 row를 추가 설비 필터 없이 그대로 drawing한다. 각 chart 하단의 NG 테이블은 `wafer_id`, `tkout_time`, `step_seq`, `eqp_id`, `lot_id`, `process_id`, `item_id`, `fab_value`를 표시하고, `fab_value` 오른쪽의 `Defect MAP보기` 버튼은 `/appdata/hadoop/code/eads/config.json` URL 템플릿의 첫 번째 `{}`에 `lot_id`, 두 번째 `{}`에 `wafer_id`, 세 번째 `{}`에 `step_seq`를 넣어 새 탭으로 연다. PM 이력 테이블은 `asset`, `work_type`, `inprg_dt`, `description`, `url` 기반 Link 버튼을 `INPRG_DT` 최신 날짜순으로 표시한다.

초기 X축 range는 all 배경 scatter와 chart별 fail/fail_std 이상 scatter의 `tkout_time`을 함께 포함해 계산한다. 따라서 fail/fail_std 파일에 all 파일보다 최신 시간이 있는 경우에도 해당 이상 point가 초기 chart 영역 안에 표시된다. P3D FCC지수 이상감지 chart의 초기 Y축 range는 연관 Step 이상감지와 FCC 이상시점 연관 Step 이상감지를 포함해 all 배경 scatter의 outlier를 제거해 계산하되, fail/fail_std scatter의 `final_decision`이 `NG`인 `fab_value`는 outlier 범위 밖이어도 포함한다. FCC 추가 chart의 all 배경 scatter는 선택 설비 row도 제외하지 않고 파일에서 읽힌 row를 함께 표시한다.

FCC chart의 기존 `main_step`, `met_step`, `item_id`는 FCC 중심치 이상 목록 값을 사용한다. `main_step`은 `U%`를 제외한 숫자, `met_step`은 중심치 이상 목록의 `met_step`/`met_seq`에서 `_` 왼쪽 값, `item_id`는 `_` 오른쪽 값을 사용해 `/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/U%{main_step}/{met_step}_{item_id}` 하위 경로를 만든다. FCC 추가 chart는 FCC 추가 MET 매핑 파일에서 `main_step`에 매핑된 `met_step`을 사용하고, FCC 추가 중심치/산포 이상 목록 `met_seq`에서 `_` 뒤 `item_id`를 가져와 `/appdata/hadoop/code/eads/PFB3/D1c_fcc/U%{main_step}/{met_step}_{item_id}` 하위 추가 scatter 경로를 만든다. FCC 추가 이상감지는 FCC 중심치 이상 목록 `eqpid`와 FCC 추가 중심치/산포 이상 목록 `eqpid`의 교집합 설비만 대상으로 하며, 교집합 설비를 클릭하면 기존 FCC all/fail 중심치 scatter chart와 FCC 추가 all/fail 또는 all/fail_std scatter chart를 각각 그린다. FCC chart 제목의 item 영역은 FCC all 배경 scatter의 `item_id`와 매칭되는 `item_desc`가 있으면 `item_desc`를 표시한다. FCC 중심치 이상 chart의 `관리STEP CHART 보기`는 FCC 중심치 이상 목록의 `eqpid`와 `main_step`을 기준으로 Data Source의 MET 매핑 파일(`/appdata/hadoop/code/eads/PFB3/met.txt`)에서 같은 `main_step`의 `met_item`과 `device`를 찾고, 개별챔버 all 배경 scatter 경로는 `PFB3/{device}/{main_step}/{met_item}_RANDOM_PC`만 읽으며, `eqp_ch`가 FCC `eqpid`와 같은 포인트를 별도 색상으로 표시한다.

좌측 FCC지수 연관 이상감지 목록은 기존 FCC 스탭 MET 매핑 파일(`/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/met_fcc.txt`)과 기존 FCC 중심치 이상 목록(`/appdata/hadoop/code/eads/PFB3/D1c_fcc/fcc_step/fail_list.parquet`) 기준으로 `main_step`과 하위 `met_step` 버튼을 구성한다. FCC 스탭 MET 매핑의 `draw_category`가 `single`인 행은 P3D FCC지수 이상감지 화면에서 제외하고, `all` 또는 빈 값은 기존처럼 표시한다. `single` 행에 매칭되는 FCC 중심치 이상은 전라인 챔버별 이상감지의 P3D/PFB3 선택에서 표시하되, 대상스탭 버튼과 chart drawing은 P3D FCC지수 이상감지에서 쓰던 FCC 스탭 MET 매핑과 FCC 중심치 이상 경로를 그대로 사용한다. 이 챔버 화면의 `single` 항목은 선택된 `met_step` chart만 그리며 FCC 추가 중심치/산포 chart는 붙이지 않는다. 기존 FCC 산포 이상 목록은 현재 참조하지 않는다. FCC 추가 중심치/산포 이상 목록은 버튼을 만들지 않고, 기존 FCC 중심치 이상 목록과 `eqpid` 교집합이 있는 경우에만 기존 FCC chart 아래 추가 chart로 표시한다.

FCC 이상시점 추가 이상 목록은 FCC지수 연관 이상감지의 FCC 중심치 이상 목록에서 온 `main_seq`와 `met_seq`의 `_` 앞 숫자 6자리를 `fail_fccdate_list.parquet.main_seq`, `fail_fccdate_list.parquet.fcc_step_seq`와 매칭해 FCC 중심치 이상 목록 파일의 `main_seq` 하위에 chart를 추가한다. chart drawing 경로의 `main_step`, `met_step`, `eqp_ch`는 각각 `fail_fccdate_list.parquet.main_seq`, `met_seq`, `eqpid` 값을 사용해 `fcc_timefit/U%{main_seq}/{met_seq}/{latestDate}` 아래 `all_fccdate_{eqpid}_U%{main_seq}.parquet`, `fail_fccdate_{eqpid}_U%{main_seq}.parquet`를 읽는다.

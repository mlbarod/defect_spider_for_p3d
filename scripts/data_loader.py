#!/usr/bin/env python3
import argparse
import ast
import json
import math
import os
import sys
from datetime import date, datetime


CONFIG = {
    "lineName": "P3D (D1c)_EQP MAIN",
    "selectLine": "PFB3",
    "device": "D1c",
    "eadsRoot": "/appdata/hadoop/code/eads",
    "pmCodePath": "/appdata/abnormal_trend/pic/pm_code_info.parquet",
}

LOADER_VERSION = "file-loader-v7"
IS_MAIN_LINE = True
FOLDER_PATH = f"{CONFIG['eadsRoot']}/{CONFIG['selectLine']}/{CONFIG['device']}"
COMPACT_TIME_FORMATS = (
    "%Y%m%d%H%M%S",
    "%Y%m%d%H%M",
    "%y%m%d%H%M%S",
    "%y%m%d%H%M",
    "%Y%m%d",
)

DATA_SOURCES = [
    {
        "key": "spec",
        "label": "Measure SPEC",
        "path": f"{CONFIG['eadsRoot']}/{CONFIG['selectLine']}/{CONFIG['device']}_measure_spec.parquet",
    },
    {
        "key": "fail",
        "label": "중심치 이상 목록",
        "path": f"{FOLDER_PATH}/{'main_fail_list.parquet' if IS_MAIN_LINE else 'fail_list.parquet'}",
    },
    {
        "key": "std",
        "label": "산포 이상 목록",
        "path": f"{FOLDER_PATH}/{'main_fail_list_std.parquet' if IS_MAIN_LINE else 'fail_list_std.parquet'}",
    },
    {
        "key": "met",
        "label": "MET 매핑",
        "path": f"{CONFIG['eadsRoot']}/{CONFIG['selectLine']}/met.txt",
    },
    {
        "key": "pm",
        "label": "PM 이력",
        "path": CONFIG["pmCodePath"],
    },
]


def json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    try:
        import numpy as np

        if isinstance(value, np.integer):
            return int(value)
        if isinstance(value, np.floating):
            return float(value)
        if isinstance(value, np.ndarray):
            return value.tolist()
    except Exception:
        pass
    return str(value)


def epoch_datetime(value):
    try:
        return datetime.fromtimestamp(value / 1000 if abs(value) > 10_000_000_000 else value)
    except Exception:
        return None


def parse_time_value(value):
    if value is None:
        return None
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)

    text = ""
    if isinstance(value, (int, float)) and value == value:
        number = int(value)
        text = str(number)
        if text.isdigit():
            for fmt in COMPACT_TIME_FORMATS:
                if len(text) == len(datetime.now().strftime(fmt)):
                    try:
                        return datetime.strptime(text, fmt)
                    except ValueError:
                        pass
        return epoch_datetime(value)

    text = str(value).strip()
    if not text:
        return None

    digits = text.split(".", 1)[0]
    if digits.isdigit():
        for fmt in COMPACT_TIME_FORMATS:
            if len(digits) == len(datetime.now().strftime(fmt)):
                try:
                    return datetime.strptime(digits, fmt)
                except ValueError:
                    pass
        number = int(digits)
        if len(digits) in (10, 13) or number > 10_000_000_000:
            return epoch_datetime(number)

    normalized = text.replace("/", "-").replace("Z", "+00:00")
    if "." in normalized:
        head, tail = normalized.split(".", 1)
        fraction = ""
        suffix = ""
        for char in tail:
            if char.isdigit() and not suffix:
                fraction += char
            else:
                suffix += char
        if len(fraction) > 6:
            normalized = f"{head}.{fraction[:6]}{suffix}"

    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def time_text(value):
    parsed = parse_time_value(value)
    if parsed is not None:
        return parsed.isoformat(sep=" ")
    return "" if value is None else str(value)


def time_ms(value):
    parsed = parse_time_value(value)
    if parsed is None:
        return None
    try:
        return int(parsed.timestamp() * 1000)
    except Exception:
        return None


def write_json(payload):
    print(json.dumps(payload, ensure_ascii=False, default=json_default))


def load_polars():
    try:
        import polars as pl

        return pl
    except ImportError as exc:
        raise RuntimeError("parquet 파일을 읽으려면 Python 패키지 polars가 필요합니다.") from exc


def source_status():
    return [
        {
            **source,
            "exists": os.path.exists(source["path"]),
            "readable": os.access(source["path"], os.R_OK),
        }
        for source in DATA_SOURCES
    ]


def require_file(path):
    if not os.path.isfile(path):
        raise FileNotFoundError(f"파일이 없습니다: {path}")
    if not os.access(path, os.R_OK):
        raise PermissionError(f"파일을 읽을 권한이 없습니다: {path}")


def read_parquet(path):
    require_file(path)
    try:
        import polars as pl

        return pl.read_parquet(path)
    except ImportError:
        try:
            import pandas as pd

            return pd.read_parquet(path)
        except ImportError as exc:
            raise RuntimeError("parquet 파일을 읽으려면 Python 패키지 polars 또는 pandas+pyarrow가 필요합니다.") from exc


def read_met_rows(path):
    require_file(path)

    with open(path, "r", encoding="utf-8") as file:
        lines = [line.rstrip("\n") for line in file]

    if not lines:
        return []

    header = [part.strip() for part in lines[0].split("\t")]
    rows = []
    for line in lines[1:]:
        values = [part.strip() for part in line.split("\t")]
        row = dict(zip(header, values))
        if row.get("device") == CONFIG["device"]:
            row["main_step"] = strip_percent_prefix(row.get("main_step", ""))
            row["met_step"] = strip_percent_prefix(row.get("met_step", ""))
            rows.append(row)
    return rows


def strip_percent_prefix(value):
    if "%" in value:
        return value.split("%", 1)[1]
    return value


def is_p4d_eqp(value):
    digits = "".join(ch if ch.isdigit() else " " for ch in str(value)).split()
    return any(token.startswith("35") for token in digits)


def frame_records(dataframe):
    if hasattr(dataframe, "to_dicts"):
        return dataframe.to_dicts()
    if hasattr(dataframe, "to_dict"):
        return dataframe.to_dict(orient="records")
    return list(dataframe)


def frame_columns(dataframe):
    return list(getattr(dataframe, "columns", []))


def frame_height(dataframe):
    return getattr(dataframe, "height", len(dataframe))


def is_polars_frame(dataframe):
    return dataframe.__class__.__module__.startswith("polars")


def sort_frame(dataframe, column):
    if column not in frame_columns(dataframe):
        return dataframe
    if is_polars_frame(dataframe):
        return dataframe.sort(column)
    return dataframe.sort_values(column)


def filter_frame_p3d_drawing(dataframe):
    if "eqp_id" not in frame_columns(dataframe):
        return dataframe
    if is_polars_frame(dataframe):
        pl = load_polars()
        return dataframe.filter(
            ~pl.col("eqp_id")
            .cast(pl.Utf8)
            .str.extract_all(r"\d+")
            .list.eval(pl.element().str.starts_with("35"))
            .list.any()
        )
    return dataframe[~dataframe["eqp_id"].astype(str).apply(is_p4d_eqp)]


def filter_frame_eqp(dataframe, eqp_id):
    eqp_columns = [column for column in ("eqp_id", "eqpid", "eqp_ch") if column in frame_columns(dataframe)]
    if not eqp_columns:
        return dataframe
    if is_polars_frame(dataframe):
        pl = load_polars()
        expression = None
        for column in eqp_columns:
            condition = pl.col(column).cast(pl.Utf8) == str(eqp_id)
            expression = condition if expression is None else expression | condition
        return dataframe.filter(expression)

    mask = None
    for column in eqp_columns:
        condition = dataframe[column].astype(str) == str(eqp_id)
        mask = condition if mask is None else mask | condition
    return dataframe[mask]


def exclude_frame_eqp(dataframe, eqp_id):
    eqp_columns = [column for column in ("eqp_id", "eqpid", "eqp_ch") if column in frame_columns(dataframe)]
    if not eqp_columns:
        return dataframe
    if is_polars_frame(dataframe):
        pl = load_polars()
        expression = None
        for column in eqp_columns:
            condition = pl.col(column).cast(pl.Utf8).fill_null("") != str(eqp_id)
            expression = condition if expression is None else expression & condition
        return dataframe.filter(expression)

    mask = None
    for column in eqp_columns:
        condition = dataframe[column].astype(str) != str(eqp_id)
        mask = condition if mask is None else mask & condition
    return dataframe[mask]


def select_frame_columns(dataframe, columns):
    existing = [column for column in columns if column in frame_columns(dataframe)]
    if is_polars_frame(dataframe):
        return dataframe.select(existing)
    return dataframe[existing]


def split_p3d_drawing_df(dataframe):
    return filter_frame_p3d_drawing(dataframe)


def records(dataframe):
    return frame_records(dataframe)


def column_values(dataframe, column):
    if column not in frame_columns(dataframe):
        return []
    if is_polars_frame(dataframe):
        return dataframe.select(column).to_series().to_list()
    return dataframe[column].tolist()


def is_missing_value(value):
    if value is None:
        return True
    try:
        return bool(value != value)
    except Exception:
        return False


def as_list(value):
    if is_missing_value(value):
        return []
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, list):
        return [item for item in value if not is_missing_value(item)]
    if isinstance(value, tuple) or isinstance(value, set):
        return [item for item in value if not is_missing_value(item)]
    return [value]


def parse_eqp_ids(value):
    values = as_list(value)
    if len(values) == 1 and isinstance(values[0], str):
        raw = values[0].strip()
        if not raw:
            return []
        if raw.startswith("[") and raw.endswith("]"):
            try:
                values = as_list(ast.literal_eval(raw))
            except Exception:
                values = [raw]
        elif "," in raw:
            values = [part.strip() for part in raw.split(",")]

    return [str(item).strip() for item in values if str(item).strip()]


def get_first(row, names):
    for name in names:
        if name in row and not is_missing_value(row[name]):
            return row[name]
    return ""


def normalize_step(value):
    return strip_percent_prefix(str(value or "").strip())


def met_lookup(met_rows):
    by_main_step = []
    by_step_desc = {}
    for row in met_rows:
        main_step = row.get("main_step") or ""
        step_desc = row.get("step_desc") or ""
        sdwt = row.get("sdwt") or ""
        if main_step:
            by_main_step.append((main_step, step_desc, sdwt))
        if step_desc and step_desc not in by_step_desc:
            by_step_desc[step_desc] = sdwt
    return by_main_step, by_step_desc


def find_step_desc(main_seq, by_main_step):
    main_seq = normalize_step(main_seq)
    for main_step, step_desc, sdwt in by_main_step:
        main_step = normalize_step(main_step)
        if main_step and (main_step in main_seq or main_seq in main_step):
            return step_desc, sdwt
    return "", ""


def add_summary_rows(target, source_rows, count_key, by_main_step):
    main_columns = ("main_seq", "대상스탭", "main_step", "mainStep")
    met_columns = ("met_seq", "계측스탭", "met_step", "metStep")
    eqp_columns = ("eqpid", "eqp_id", "eqpIds", "eqp_ids")

    added = 0
    for row in source_rows:
        main_step_raw = str(get_first(row, main_columns) or "").strip()
        met_step_raw = str(get_first(row, met_columns) or "").strip()
        main_step = normalize_step(main_step_raw)
        met_step = normalize_step(met_step_raw)
        if not main_step or not met_step:
            continue

        key = f"{main_step}::{met_step}"
        step_desc, sdwt = find_step_desc(main_step, by_main_step)
        eqp_ids = parse_eqp_ids(get_first(row, eqp_columns))
        if (CONFIG["selectLine"] == "PFB3" and CONFIG["device"] == "D1c") or CONFIG["selectLine"] == "P4D":
            eqp_ids = [eqp_id for eqp_id in eqp_ids if not is_p4d_eqp(eqp_id)]
        if not eqp_ids:
            continue

        current = target.setdefault(
            key,
            {
                "key": key,
                "mainStep": main_step,
                "mainStepPath": main_step_raw or main_step,
                "stepSeq": main_step,
                "metStep": met_step,
                "metStepPath": met_step_raw or met_step,
                "stepDesc": step_desc,
                "sdwt": sdwt,
                "centerCount": 0,
                "stdCount": 0,
                "eqpIds": [],
            },
        )

        if step_desc and not current["stepDesc"]:
            current["stepDesc"] = step_desc
        if sdwt and not current["sdwt"]:
            current["sdwt"] = sdwt

        current[count_key] = len(eqp_ids)
        current["eqpIds"] = sorted(set(current["eqpIds"]) | set(eqp_ids))
        added += 1

    return added


def load_optional_parquet(source, diagnostics):
    try:
        dataframe = read_parquet(source["path"])
        diagnostics["inputRows"][source["key"]] = frame_height(dataframe)
        diagnostics["columns"][source["key"]] = frame_columns(dataframe)
        return frame_records(dataframe)
    except Exception as exc:
        diagnostics["warnings"].append(f"{source['label']} 읽기 실패: {exc}")
        diagnostics["inputRows"][source["key"]] = 0
        diagnostics["columns"][source["key"]] = []
        return []


def command_summary(_args):
    diagnostics = {
        "version": LOADER_VERSION,
        "inputRows": {},
        "columns": {},
        "usedRows": {},
        "outputRows": 0,
        "warnings": [],
    }
    fail_rows = load_optional_parquet(DATA_SOURCES[1], diagnostics)
    std_rows = load_optional_parquet(DATA_SOURCES[2], diagnostics)
    try:
        met_rows = read_met_rows(DATA_SOURCES[3]["path"])
        diagnostics["inputRows"]["met"] = len(met_rows)
        diagnostics["columns"]["met"] = list(met_rows[0].keys()) if met_rows else []
    except Exception as exc:
        met_rows = []
        diagnostics["inputRows"]["met"] = 0
        diagnostics["columns"]["met"] = []
        diagnostics["warnings"].append(f"{DATA_SOURCES[3]['label']} 읽기 실패: {exc}")

    by_main_step, _by_step_desc = met_lookup(met_rows)
    merged = {}
    diagnostics["usedRows"]["fail"] = add_summary_rows(merged, fail_rows, "centerCount", by_main_step)
    diagnostics["usedRows"]["std"] = add_summary_rows(merged, std_rows, "stdCount", by_main_step)

    rows = [
        row
        for row in merged.values()
        if row["centerCount"] != 0 or row["stdCount"] != 0
    ]
    rows.sort(key=lambda row: (row["mainStep"], row["metStep"]))
    diagnostics["outputRows"] = len(rows)

    if not fail_rows and not std_rows:
        write_json(
            {
                "ok": False,
                "error": "중심치/산포 이상 parquet에서 읽은 행이 없습니다. 파일 경로, 권한, parquet 의존성을 확인하세요.",
                "config": CONFIG,
                "sources": source_status(),
                "diagnostics": diagnostics,
                "rows": [],
            }
        )
        return

    write_json(
        {
            "ok": True,
            "config": CONFIG,
            "sources": source_status(),
            "diagnostics": diagnostics,
            "rows": rows,
        }
    )


def latest_child_dir(path):
    if not os.path.isdir(path):
        raise FileNotFoundError(f"디렉터리가 없습니다: {path}")

    names = [
        name
        for name in os.listdir(path)
        if os.path.isdir(os.path.join(path, name))
    ]
    if not names:
        raise FileNotFoundError(f"하위 날짜 디렉터리가 없습니다: {path}")
    return sorted(names)[-1]


def unique_nonempty(values):
    result = []
    seen = set()
    for value in values:
        value = str(value or "").strip()
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def strip_main_suffix(value):
    value = str(value or "").strip()
    while value.endswith("_main"):
        value = value[: -len("_main")]
    return value


def normalize_dir_key(value, is_met=False):
    value = normalize_step(value).lower()
    if is_met:
        value = strip_main_suffix(value)
    return value


def chart_met_step_candidates(chart_met_step):
    raw = normalize_step(chart_met_step)
    base = strip_main_suffix(raw)
    candidates = [raw, raw.replace("_main_main", "_main"), base]
    if IS_MAIN_LINE:
        candidates.append(f"{base}_main")
    return unique_nonempty(candidates)


def list_child_dirs(path):
    if not os.path.isdir(path):
        return []
    return sorted(
        name
        for name in os.listdir(path)
        if os.path.isdir(os.path.join(path, name))
    )


def resolve_child_dir(parent, candidates, label, is_met=False):
    attempts = [os.path.join(parent, candidate) for candidate in candidates]
    for attempt in attempts:
        if os.path.isdir(attempt):
            return attempt, os.path.basename(attempt), attempts

    children = list_child_dirs(parent)
    if not children:
        raise FileNotFoundError(
            f"{label} 디렉터리가 없습니다: {parent}. 시도한 경로: {', '.join(attempts[:5])}"
        )

    candidate_keys = {normalize_dir_key(candidate, is_met=is_met) for candidate in candidates}
    for child in children:
        if normalize_dir_key(child, is_met=is_met) in candidate_keys:
            return os.path.join(parent, child), child, attempts

    for child in children:
        child_key = normalize_dir_key(child, is_met=is_met)
        if any(key and (key in child_key or child_key in key) for key in candidate_keys):
            return os.path.join(parent, child), child, attempts

    raise FileNotFoundError(
        f"{label} 디렉터리를 찾지 못했습니다. 시도: {', '.join(candidates[:6])}. "
        f"사용 가능 예: {', '.join(children[:8])}"
    )


def resolve_parquet_file(data_dir, prefix, main_candidates):
    exact_names = [f"{prefix}_{candidate}.parquet" for candidate in main_candidates]
    for name in exact_names:
        path = os.path.join(data_dir, name)
        if os.path.isfile(path):
            return path, exact_names

    if not os.path.isdir(data_dir):
        raise FileNotFoundError(f"날짜 데이터 디렉터리가 없습니다: {data_dir}")

    parquet_files = sorted(
        name
        for name in os.listdir(data_dir)
        if name.startswith(f"{prefix}_") and name.endswith(".parquet")
    )
    if parquet_files:
        return os.path.join(data_dir, parquet_files[0]), exact_names

    raise FileNotFoundError(
        f"{prefix} parquet 파일을 찾지 못했습니다: {data_dir}. "
        f"시도: {', '.join(exact_names[:5])}. 사용 가능 파일 예: {', '.join(sorted(os.listdir(data_dir))[:8])}"
    )


def resolve_chart_paths(main_step, chart_met_step):
    main_candidates = unique_nonempty([main_step, normalize_step(main_step)])
    main_dir, main_dir_name, main_attempts = resolve_child_dir(FOLDER_PATH, main_candidates, "main_step")

    met_candidates = chart_met_step_candidates(chart_met_step)
    met_dir, met_dir_name, met_attempts = resolve_child_dir(main_dir, met_candidates, "met_step", is_met=True)

    latest_date = latest_child_dir(met_dir)
    data_dir = os.path.join(met_dir, latest_date)
    main_file_candidates = unique_nonempty([main_dir_name, main_step, normalize_step(main_step)])
    all_prefix = "main_all" if IS_MAIN_LINE else "all"
    fail_prefix = "main_fail" if IS_MAIN_LINE else "fail"
    std_prefix = "main_fail_std" if IS_MAIN_LINE else "fail_std"
    all_path, all_attempts = resolve_parquet_file(data_dir, all_prefix, main_file_candidates)
    fail_path, fail_attempts = resolve_parquet_file(data_dir, fail_prefix, main_file_candidates)
    try:
        std_path, std_attempts = resolve_parquet_file(data_dir, std_prefix, main_file_candidates)
    except FileNotFoundError:
        std_path = None
        std_attempts = [f"{std_prefix}_{candidate}.parquet" for candidate in main_file_candidates]

    return {
        "mainDir": main_dir,
        "metDir": met_dir,
        "dataDir": data_dir,
        "latestDate": latest_date,
        "allPath": all_path,
        "failPath": fail_path,
        "stdPath": std_path,
        "requested": {
            "mainStep": main_step,
            "chartMetStep": chart_met_step,
        },
        "resolved": {
            "mainStep": main_dir_name,
            "chartMetStep": met_dir_name,
        },
        "attempts": {
            "mainDirs": main_attempts,
            "metDirs": met_attempts,
            "allFiles": all_attempts,
            "failFiles": fail_attempts,
            "stdFiles": std_attempts,
        },
    }


def sample_records(dataframe, limit=900):
    if limit is None:
        return records(dataframe)
    height = frame_height(dataframe)
    if height <= limit:
        return records(dataframe)
    if limit <= 1:
        indices = [0]
    else:
        indices = sorted({round(index * (height - 1) / (limit - 1)) for index in range(limit)})
    if is_polars_frame(dataframe):
        pl = load_polars()
        sample_index = "__sample_index"
        return records(dataframe.with_row_index(sample_index).filter(pl.col(sample_index).is_in(indices)).drop(sample_index))
    return records(dataframe.iloc[indices])


def add_time_fields(rows, column):
    for row in rows:
        value = row.get(column)
        row[f"{column}_text"] = time_text(value)
        row[f"{column}_ms"] = time_ms(value)
    return rows


def select_columns(dataframe):
    wanted = [
        "tkout_time",
        "fab_value",
        "process_id",
        "wafer_id",
        "lot_id",
        "lot_wf",
        "step_seq",
        "eqp_ch",
        "eqp_id",
        "eqpid",
        "item_id",
        "final_decision",
    ]
    return select_frame_columns(dataframe, wanted)


def chart_records(dataframe, limit=900, anomaly_type=None):
    rows = add_time_fields(sample_records(select_columns(dataframe), limit), "tkout_time")
    if anomaly_type:
        for row in rows:
            row["anomaly_type"] = anomaly_type
    return rows


def numeric_domain(values):
    if not values:
        return None
    return {"min": min(values), "max": max(values)}


def numeric_column_values(dataframe, column):
    values = []
    for value in column_values(dataframe, column):
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(number):
            values.append(number)
    return values


def percentile(sorted_values, ratio):
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = (len(sorted_values) - 1) * ratio
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return sorted_values[lower]
    weight = position - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def outlier_filtered_values(values):
    if len(values) < 4:
        return values

    sorted_values = sorted(values)
    q1 = percentile(sorted_values, 0.25)
    q3 = percentile(sorted_values, 0.75)
    iqr = q3 - q1
    if iqr <= 0:
        return values

    lower = q1 - iqr * 1.5
    upper = q3 + iqr * 1.5
    filtered = [value for value in values if lower <= value <= upper]
    return filtered or values


def outlier_display_domain(values):
    filtered = outlier_filtered_values(values)
    if not filtered:
        return None
    return {"min": min(filtered) - 2, "max": max(filtered) * 1.2}


def time_domain(dataframe, column):
    values = [value for value in (time_ms(value) for value in column_values(dataframe, column)) if value is not None]
    if not values:
        return None
    return {"min": min(values), "max": max(values)}


def command_chart(args):
    resolved_paths = resolve_chart_paths(args.main_step, args.chart_met_step)
    all_path = resolved_paths["allPath"]
    fail_path = resolved_paths["failPath"]
    std_path = resolved_paths["stdPath"]

    all_df = split_p3d_drawing_df(read_parquet(all_path))
    fail_df = split_p3d_drawing_df(read_parquet(fail_path))
    std_df = split_p3d_drawing_df(read_parquet(std_path)) if std_path else fail_df.head(0)

    all_df = sort_frame(all_df, "tkout_time")
    fail_df = sort_frame(fail_df, "tkout_time")
    std_df = sort_frame(std_df, "tkout_time")
    all_background = exclude_frame_eqp(all_df, args.eqp_id)
    fail_for_eqp = filter_frame_eqp(fail_df, args.eqp_id)
    std_for_eqp = filter_frame_eqp(std_df, args.eqp_id)
    chart_fab_values_center = numeric_column_values(all_background, "fab_value") + numeric_column_values(fail_for_eqp, "fab_value")
    chart_fab_values_std = numeric_column_values(all_background, "fab_value") + numeric_column_values(std_for_eqp, "fab_value")
    chart_fab_values = chart_fab_values_center + numeric_column_values(std_for_eqp, "fab_value")

    pm_events = []
    if os.path.isfile(CONFIG["pmCodePath"]) and os.access(CONFIG["pmCodePath"], os.R_OK):
        pm_df = read_parquet(CONFIG["pmCodePath"])
        if {"asset", "inprg_dt", "work_type"}.issubset(set(frame_columns(pm_df))):
            if is_polars_frame(pm_df):
                pl = load_polars()
                pm_df = pm_df.with_columns(pl.col("asset").cast(pl.Utf8).str.replace_all("-", "_").alias("asset"))
                pm_df = pm_df.filter(pl.col("asset").str.contains(str(args.eqp_id), literal=True))
                pm_events = add_time_fields(records(pm_df.select(["inprg_dt", "work_type"]).head(80)), "inprg_dt")
            else:
                pm_df = pm_df.copy()
                pm_df["asset"] = pm_df["asset"].astype(str).str.replace("-", "_", regex=False)
                pm_df = pm_df[pm_df["asset"].str.contains(str(args.eqp_id), regex=False, na=False)]
                pm_events = add_time_fields(records(pm_df[["inprg_dt", "work_type"]].head(80)), "inprg_dt")

    write_json(
        {
            "ok": True,
            "diagnostics": {
                "version": LOADER_VERSION,
                "resolvedPaths": resolved_paths,
                "inputRows": {
                    "all": frame_height(all_df),
                    "allBackground": frame_height(all_background),
                    "fail": frame_height(fail_df),
                    "failForEqp": frame_height(fail_for_eqp),
                    "std": frame_height(std_df),
                    "stdForEqp": frame_height(std_for_eqp),
                },
            },
            "paths": {
                "all": all_path,
                "fail": fail_path,
                "std": std_path,
                "pm": CONFIG["pmCodePath"],
            },
            "latestDate": resolved_paths["latestDate"],
            "domains": {
                "x": time_domain(all_df, "tkout_time"),
                "yFull": numeric_domain(chart_fab_values),
                "yInitial": outlier_display_domain(chart_fab_values),
                "center": {
                    "yFull": numeric_domain(chart_fab_values_center),
                    "yInitial": outlier_display_domain(chart_fab_values_center),
                },
                "std": {
                    "yFull": numeric_domain(chart_fab_values_std),
                    "yInitial": outlier_display_domain(chart_fab_values_std),
                },
            },
            "allPoints": chart_records(all_background, None),
            "failPoints": chart_records(fail_for_eqp, None, "center"),
            "stdPoints": chart_records(std_for_eqp, None, "std"),
            "pmEvents": pm_events,
        }
    )


def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("summary")
    chart_parser = subparsers.add_parser("chart")
    chart_parser.add_argument("--main-step", required=True)
    chart_parser.add_argument("--chart-met-step", required=True)
    chart_parser.add_argument("--eqp-id", required=True)
    args = parser.parse_args()

    try:
        if args.command == "summary":
            command_summary(args)
        elif args.command == "chart":
            command_chart(args)
    except Exception as exc:
        write_json(
            {
                "ok": False,
                "error": str(exc),
                "config": CONFIG,
                "diagnostics": {"version": LOADER_VERSION},
                "sources": source_status(),
            }
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

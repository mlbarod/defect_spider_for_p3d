#!/usr/bin/env python3
import argparse
import ast
import json
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

LOADER_VERSION = "file-loader-v2"
IS_MAIN_LINE = True
FOLDER_PATH = f"{CONFIG['eadsRoot']}/{CONFIG['selectLine']}/{CONFIG['device']}"

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
    if "eqp_id" not in frame_columns(dataframe):
        return dataframe
    if is_polars_frame(dataframe):
        pl = load_polars()
        return dataframe.filter(pl.col("eqp_id").cast(pl.Utf8) == str(eqp_id))
    return dataframe[dataframe["eqp_id"].astype(str) == str(eqp_id)]


def select_frame_columns(dataframe, columns):
    existing = [column for column in columns if column in frame_columns(dataframe)]
    if is_polars_frame(dataframe):
        return dataframe.select(existing)
    return dataframe[existing]


def split_p3d_drawing_df(dataframe):
    return filter_frame_p3d_drawing(dataframe)


def records(dataframe):
    return frame_records(dataframe)


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
        main_step = normalize_step(get_first(row, main_columns))
        met_step = normalize_step(get_first(row, met_columns))
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
                "metStep": met_step,
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


def sample_records(dataframe, limit=900):
    height = frame_height(dataframe)
    if height <= limit:
        return records(dataframe)
    step = max(1, height // limit)
    if is_polars_frame(dataframe):
        return records(dataframe[::step].head(limit))
    return records(dataframe.iloc[::step].head(limit))


def select_columns(dataframe):
    wanted = [
        "tkout_time",
        "fab_value",
        "process_id",
        "lot_wf",
        "step_seq",
        "eqp_ch",
        "eqp_id",
        "final_decision",
    ]
    return select_frame_columns(dataframe, wanted)


def command_chart(args):
    chart_dir = os.path.join(FOLDER_PATH, args.main_step, args.chart_met_step)
    latest_date = latest_child_dir(chart_dir)
    data_dir = os.path.join(chart_dir, latest_date)
    all_path = os.path.join(data_dir, f"{'main_all' if IS_MAIN_LINE else 'all'}_{args.main_step}.parquet")
    fail_path = os.path.join(data_dir, f"{'main_fail' if IS_MAIN_LINE else 'fail'}_{args.main_step}.parquet")

    all_df = split_p3d_drawing_df(read_parquet(all_path))
    fail_df = split_p3d_drawing_df(read_parquet(fail_path))

    all_df = sort_frame(all_df, "tkout_time")
    fail_df = sort_frame(fail_df, "tkout_time")
    fail_for_eqp = filter_frame_eqp(fail_df, args.eqp_id)

    pm_events = []
    if os.path.isfile(CONFIG["pmCodePath"]) and os.access(CONFIG["pmCodePath"], os.R_OK):
        pm_df = read_parquet(CONFIG["pmCodePath"])
        if {"asset", "inprg_dt", "work_type"}.issubset(set(frame_columns(pm_df))):
            if is_polars_frame(pm_df):
                pl = load_polars()
                pm_df = pm_df.with_columns(pl.col("asset").cast(pl.Utf8).str.replace_all("-", "_").alias("asset"))
                pm_df = pm_df.filter(pl.col("asset").str.contains(str(args.eqp_id), literal=True))
                pm_events = records(pm_df.select(["inprg_dt", "work_type"]).head(80))
            else:
                pm_df = pm_df.copy()
                pm_df["asset"] = pm_df["asset"].astype(str).str.replace("-", "_", regex=False)
                pm_df = pm_df[pm_df["asset"].str.contains(str(args.eqp_id), regex=False, na=False)]
                pm_events = records(pm_df[["inprg_dt", "work_type"]].head(80))

    write_json(
        {
            "ok": True,
            "diagnostics": {"version": LOADER_VERSION},
            "paths": {
                "all": all_path,
                "fail": fail_path,
                "pm": CONFIG["pmCodePath"],
            },
            "latestDate": latest_date,
            "allPoints": sample_records(select_columns(all_df)),
            "failPoints": sample_records(select_columns(fail_for_eqp), 500),
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

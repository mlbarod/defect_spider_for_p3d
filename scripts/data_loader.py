#!/usr/bin/env python3
import argparse
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
    pl = load_polars()
    return pl.read_parquet(path)


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


def split_p3d_p4d_list_df(dataframe):
    pl = load_polars()
    return dataframe.with_columns(
        pl.col("eqpid")
        .map_elements(
            lambda values: [str(value) for value in (values or []) if not is_p4d_eqp(value)],
            return_dtype=pl.List(pl.Utf8),
        )
        .alias("eqpid")
    ).filter(pl.col("eqpid").list.len() > 0)


def split_p3d_drawing_df(dataframe):
    pl = load_polars()
    if "eqp_id" not in dataframe.columns:
        return dataframe
    return dataframe.filter(
        ~pl.col("eqp_id")
        .cast(pl.Utf8)
        .str.extract_all(r"\d+")
        .list.eval(pl.element().str.starts_with("35"))
        .list.any()
    )


def records(dataframe):
    return dataframe.to_dicts()


def as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item is not None]
    if isinstance(value, tuple):
        return [str(item) for item in value if item is not None]
    return [str(value)]


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
    main_seq = str(main_seq)
    for main_step, step_desc, sdwt in by_main_step:
        if main_step and main_step in main_seq:
            return step_desc, sdwt
    return "", ""


def add_summary_rows(target, dataframe, count_key, by_main_step):
    for row in records(dataframe):
        main_step = str(row.get("main_seq", ""))
        met_step = str(row.get("met_seq", ""))
        if not main_step or not met_step:
            continue

        key = f"{main_step}::{met_step}"
        step_desc, sdwt = find_step_desc(main_step, by_main_step)
        eqp_ids = as_list(row.get("eqpid"))
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


def command_summary(_args):
    fail = read_parquet(DATA_SOURCES[1]["path"])
    std = read_parquet(DATA_SOURCES[2]["path"])
    met_rows = read_met_rows(DATA_SOURCES[3]["path"])

    if (CONFIG["selectLine"] == "PFB3" and CONFIG["device"] == "D1c") or CONFIG["selectLine"] == "P4D":
        fail = split_p3d_p4d_list_df(fail)
        std = split_p3d_p4d_list_df(std)

    by_main_step, _by_step_desc = met_lookup(met_rows)
    merged = {}
    add_summary_rows(merged, fail, "centerCount", by_main_step)
    add_summary_rows(merged, std, "stdCount", by_main_step)

    rows = [
        row
        for row in merged.values()
        if row["centerCount"] != 0 or row["stdCount"] != 0
    ]
    rows.sort(key=lambda row: (row["mainStep"], row["metStep"]))
    write_json({"ok": True, "config": CONFIG, "sources": source_status(), "rows": rows})


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
    if dataframe.height <= limit:
        return records(dataframe)
    step = max(1, dataframe.height // limit)
    return records(dataframe[::step].head(limit))


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
    return dataframe.select([column for column in wanted if column in dataframe.columns])


def command_chart(args):
    chart_dir = os.path.join(FOLDER_PATH, args.main_step, args.chart_met_step)
    latest_date = latest_child_dir(chart_dir)
    data_dir = os.path.join(chart_dir, latest_date)
    all_path = os.path.join(data_dir, f"{'main_all' if IS_MAIN_LINE else 'all'}_{args.main_step}.parquet")
    fail_path = os.path.join(data_dir, f"{'main_fail' if IS_MAIN_LINE else 'fail'}_{args.main_step}.parquet")

    all_df = split_p3d_drawing_df(read_parquet(all_path))
    fail_df = split_p3d_drawing_df(read_parquet(fail_path))

    pl = load_polars()
    if "tkout_time" in all_df.columns:
        all_df = all_df.sort("tkout_time")
    if "tkout_time" in fail_df.columns:
        fail_df = fail_df.sort("tkout_time")
    if "eqp_id" in fail_df.columns:
        fail_for_eqp = fail_df.filter(pl.col("eqp_id").cast(pl.Utf8) == str(args.eqp_id))
    else:
        fail_for_eqp = fail_df

    pm_events = []
    if os.path.isfile(CONFIG["pmCodePath"]) and os.access(CONFIG["pmCodePath"], os.R_OK):
        pm_df = read_parquet(CONFIG["pmCodePath"])
        if {"asset", "inprg_dt", "work_type"}.issubset(set(pm_df.columns)):
            pm_df = pm_df.with_columns(pl.col("asset").cast(pl.Utf8).str.replace_all("-", "_").alias("asset"))
            pm_df = pm_df.filter(pl.col("asset").str.contains(str(args.eqp_id), literal=True))
            pm_events = records(pm_df.select(["inprg_dt", "work_type"]).head(80))

    write_json(
        {
            "ok": True,
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
                "sources": source_status(),
            }
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

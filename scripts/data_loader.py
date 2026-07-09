#!/usr/bin/env python3
import argparse
import ast
import json
import math
import os
import pickle
import sys
from datetime import date, datetime


CONFIG = {
    "lineName": "P3D (D1c)_EQP MAIN",
    "selectLine": "PFB3",
    "device": "D1c",
    "eadsRoot": "/appdata/hadoop/code/eads",
    "pmCodePath": "/appdata/abnormal_trend/pic/change_code_info.parquet",
}

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_INFO_PATH = os.path.join(ROOT_DIR, "db_info.pkl")
LOADER_VERSION = "file-loader-v45"
IS_MAIN_LINE = True
FOLDER_PATH = f"{CONFIG['eadsRoot']}/{CONFIG['selectLine']}/{CONFIG['device']}"
FCC_FOLDER_PATH = f"{CONFIG['eadsRoot']}/{CONFIG['selectLine']}/{CONFIG['device']}_fcc"
FCC_STEP_PATH = f"{FCC_FOLDER_PATH}/fcc_step"
FCC_TIMEFIT_PATH = f"{FCC_FOLDER_PATH}/fcc_timefit"
LINE_MAPPING_PATH = os.environ.get("LINE_MAPPING_PATH") or f"{CONFIG['eadsRoot']}/line_mapping.txt"
FCC_DRAW_CATEGORY_SINGLE = "single"
FCC_SINGLE_CHAMBER_LINE_CODE = "PFB3"
COMPACT_TIME_FORMATS = (
    "%Y%m%d%H%M%S",
    "%Y%m%d%H%M",
    "%y%m%d%H%M%S",
    "%y%m%d%H%M",
    "%Y%m%d",
)
PM_EQUIPMENT_COLUMNS = ("eqp_ch", "eqpch", "eqp_id", "eqpid")
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

FCC_DATA_SOURCES = [
    {
        "key": "fcc_step_met",
        "label": "FCC 스탭 MET 매핑",
        "path": f"{FCC_STEP_PATH}/met_fcc.txt",
    },
    {
        "key": "fcc_fail",
        "label": "FCC 중심치 이상 목록",
        "path": f"{FCC_STEP_PATH}/fail_list.parquet",
    },
    {
        "key": "fcc_extra_met",
        "label": "FCC 추가 MET 매핑",
        "path": f"{FCC_FOLDER_PATH}/met_fcc.txt",
    },
    {
        "key": "fcc_extra_fail",
        "label": "FCC 추가 중심치 이상 목록",
        "path": f"{FCC_FOLDER_PATH}/fail_list.parquet",
    },
    {
        "key": "fcc_extra_std",
        "label": "FCC 추가 산포 이상 목록",
        "path": f"{FCC_FOLDER_PATH}/fail_list_std.parquet",
    },
    {
        "key": "fcc_timefit_fail_list",
        "label": "FCC 이상시점 추가 이상 목록",
        "path": f"{FCC_TIMEFIT_PATH}/fail_fccdate_list.parquet",
    },
]

CHAMBER_DATA_SOURCES = [
    {
        "key": "line_mapping",
        "label": "개별 챔버 이상감지 라인 매핑파일",
        "path": LINE_MAPPING_PATH,
    }
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


def source_status(sources=DATA_SOURCES):
    statuses = []
    for source in sources:
        path = source["path"]
        statuses.append(
            {
                **source,
                "absolutePath": os.path.abspath(path),
                "exists": os.path.exists(path),
                "readable": os.access(path, os.R_OK),
            }
        )
    return statuses


def resolved_paths_for_command(command, line_mapping_path=None):
    if command.startswith("chamber"):
        return {
            "lineMappingPath": os.path.abspath(line_mapping_path or LINE_MAPPING_PATH),
        }
    return {}


def get_remote_ip():
    ip_addr = str(os.environ.get("REMOTE_ADDR") or "").strip()
    if ip_addr.startswith("::ffff:"):
        return ip_addr[7:]
    return ip_addr


def normalize_history_select_step(value):
    return str(value or "").strip().split("_", 1)[0].strip()


def load_db_info():
    with open(DB_INFO_PATH, "rb") as file:
        db_info = pickle.load(file)

    return {
        "DB_HOST": db_info["DB_HOST"],
        "DB_PORT": int(db_info["DB_PORT"]),
        "DB_NAME": db_info["DB_NAME"],
        "DB_USER": db_info["DB_USER"],
        "DB_PASSWORD": db_info["DB_PASSWORD"],
        "HDFS_HOST": db_info["HDFS_HOST"],
        "HDFS_NAME": db_info["HDFS_NAME"],
        "HDFS_PASSWORD": db_info["HDFS_PASSWORD"],
    }


def load_ip_info(ip_addr, db_info):
    import pandas as pd
    import pymysql

    with pymysql.connect(
        host=db_info["DB_HOST"],
        user=db_info["DB_USER"],
        password=db_info["DB_PASSWORD"],
        db=db_info["DB_NAME"],
        charset="utf8",
        port=db_info["DB_PORT"],
    ) as conn:
        cursor = conn.cursor()
        qry = """
            WITH A AS (
                SELECT IP_ADDR, SUB_USER_ID, USER_NAME
                FROM v_ipms_ip_info
                WHERE IP_ADDR = %s and STATUS = '승인'
            )
            SELECT ip, knox_id, sdwt, available
            FROM user_info
            JOIN A ON knox_id = SUB_USER_ID
        """
        cursor.execute(qry, (ip_addr,))
        ip_info = pd.DataFrame(cursor.fetchall(), columns=["ip", "knox_id", "sdwt", "available"])
        cursor.close()
    return ip_info


def first_ip_info_value(ip_info, column, default=""):
    try:
        if ip_info.empty or column not in ip_info.columns:
            return default
        values = ip_info[column].values
        if len(values) == 0:
            return default
        return "" if is_missing_value(values[0]) else values[0]
    except Exception:
        return default


def quote_db_identifier(value):
    return f"`{str(value).replace('`', '``')}`"


def normalize_db_column(value):
    return "".join(char for char in str(value or "").lower() if char.isalnum())


def clicked_history_columns(conn):
    cursor = conn.cursor()
    try:
        cursor.execute("SHOW COLUMNS FROM `clicked_category_history`")
        return [
            {
                "field": row[0],
                "type": row[1],
                "null": row[2],
                "key": row[3],
                "default": row[4],
                "extra": row[5],
            }
            for row in cursor.fetchall()
        ]
    finally:
        cursor.close()


def clicked_history_value_map(history_data, ip_info):
    line_name, select_step, update_date, knox_id = history_data
    ip_addr = first_ip_info_value(ip_info, "ip")
    sdwt = first_ip_info_value(ip_info, "sdwt")
    available = first_ip_info_value(ip_info, "available")

    return {
        "linename": line_name,
        "line": line_name,
        "selectline": line_name,
        "category": line_name,
        "selectstep": select_step,
        "step": select_step,
        "stepseq": select_step,
        "updatedate": update_date,
        "updatedt": update_date,
        "datetime": update_date,
        "date": update_date,
        "createdat": update_date,
        "createddate": update_date,
        "createtime": update_date,
        "regdate": update_date,
        "insertdate": update_date,
        "timestamp": update_date,
        "knoxid": knox_id,
        "userid": knox_id,
        "subuserid": knox_id,
        "updateuser": knox_id,
        "createuser": knox_id,
        "reguser": knox_id,
        "ip": ip_addr,
        "ipaddr": ip_addr,
        "ipaddress": ip_addr,
        "sdwt": sdwt,
        "available": available,
    }


def insert_clicked_category_history(conn, history_data, ip_info):
    columns = clicked_history_columns(conn)
    value_map = clicked_history_value_map(history_data, ip_info)
    insert_columns = []
    insert_values = []
    missing_required_columns = []

    for column in columns:
        field = column["field"]
        normalized = normalize_db_column(field)
        if normalized in value_map:
            insert_columns.append(field)
            insert_values.append(value_map[normalized])
            continue

        extra = str(column.get("extra") or "").lower()
        has_default = column.get("default") is not None
        allows_null = str(column.get("null") or "").upper() == "YES"
        if "auto_increment" not in extra and not has_default and not allows_null:
            missing_required_columns.append(field)

    if missing_required_columns:
        raise RuntimeError(
            "clicked_category_history 필수 컬럼 값을 만들 수 없습니다: "
            + ", ".join(missing_required_columns)
        )

    if not insert_columns:
        raise RuntimeError("clicked_category_history에 매핑 가능한 컬럼이 없습니다.")

    if "update_date" in [column["field"] for column in columns] and "update_date" not in insert_columns:
        raise RuntimeError("clicked_category_history.update_date 컬럼에 매핑할 update_date 값을 찾지 못했습니다.")

    placeholders = ", ".join(["%s"] * len(insert_values))
    column_sql = ", ".join(quote_db_identifier(column) for column in insert_columns)
    sql = f"""
        INSERT INTO `clicked_category_history` ({column_sql})
        VALUES ({placeholders})
    """
    cursor = conn.cursor()
    try:
        cursor.execute(sql, insert_values)
        conn.commit()
    finally:
        cursor.close()

    return {
        "insertedValueCount": len(insert_values),
        "insertedColumns": insert_columns,
    }


def insert_clicked_history_defect(conn, history_data):
    sql = """
        INSERT INTO `clicked_history_defect`
        VALUES (%s, %s, %s, %s)
    """
    cursor = conn.cursor()
    try:
        cursor.execute(sql, history_data)
        conn.commit()
    finally:
        cursor.close()

    return {
        "insertedValueCount": len(history_data),
        "insertedTable": "clicked_history_defect",
    }


def ClickedCategoryUpLoad(history_data, db_info, ip_info):
    import pymysql

    with pymysql.connect(
        host=db_info["DB_HOST"],
        user=db_info["DB_USER"],
        password=db_info["DB_PASSWORD"],
        db=db_info["DB_NAME"],
        charset="utf8",
        port=db_info["DB_PORT"],
    ) as conn:
        category_result = insert_clicked_category_history(conn, history_data, ip_info)
        defect_result = insert_clicked_history_defect(conn, history_data)

    return {
        "insertedValueCount": defect_result["insertedValueCount"],
        "categoryHistory": category_result,
        "defectHistory": defect_result,
    }


def command_click_history(args):
    ip_addr = get_remote_ip()
    select_step = normalize_history_select_step(args.select_step)
    diagnostics = {
        "version": LOADER_VERSION,
        "remoteIp": ip_addr,
        "ipInHistoryData": False,
    }

    try:
        db_info = load_db_info()
    except Exception as exc:
        write_json(
            {
                "ok": False,
                "error": str(exc),
                "diagnostics": diagnostics,
            }
        )
        return

    ip_info = load_ip_info(ip_addr, db_info)
    if ip_info.empty:
        write_json(
            {
                "ok": False,
                "error": f"승인된 접속자 정보를 찾지 못했습니다: {ip_addr}",
                "diagnostics": {**diagnostics, "ipInfoRows": 0, "knoxIdFound": False},
            }
        )
        return
    knox_id = first_ip_info_value(ip_info, "knox_id")
    if not knox_id:
        write_json(
            {
                "ok": False,
                "error": f"접속자 knox_id를 찾지 못했습니다: {ip_addr}",
                "diagnostics": {**diagnostics, "ipInfoRows": len(ip_info), "knoxIdFound": False},
            }
        )
        return

    history_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    history_data = (args.line_name, select_step, history_time, knox_id)
    diagnostics = {
        **diagnostics,
        "ipInfoRows": len(ip_info),
        "knoxIdFound": bool(knox_id),
    }
    try:
        result = ClickedCategoryUpLoad(history_data, db_info, ip_info)
    except Exception as exc:
        write_json(
            {
                "ok": False,
                "error": str(exc),
                "historyData": history_data,
                "diagnostics": diagnostics,
            }
        )
        return

    write_json(
        {
            "ok": True,
            "historyData": history_data,
            "diagnostics": {
                **diagnostics,
                **result,
            },
        }
    )


def require_file(path):
    if not os.path.isfile(path):
        raise FileNotFoundError(f"파일이 없습니다: {path}")
    if not os.access(path, os.R_OK):
        raise PermissionError(f"파일을 읽을 권한이 없습니다: {path}")


def read_text_file(path):
    require_file(path)
    with open(path, "r", encoding="utf-8") as file:
        return file.read()


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


def read_met_rows(path, device=CONFIG["device"]):
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
        if device and "device" in row and row.get("device") and row.get("device") != device:
            continue
        row["main_step"] = strip_percent_prefix(row.get("main_step", ""))
        row["met_step"] = strip_percent_prefix(row.get("met_step", ""))
        rows.append(row)
    return rows


def read_tab_rows_from_text(content):
    lines = [line.rstrip("\r") for line in content.splitlines() if line.strip()]
    if not lines:
        return [], []

    header = [part.strip().lstrip("\ufeff") for part in lines[0].split("\t")]
    rows = []
    for line in lines[1:]:
        values = [part.strip() for part in line.split("\t")]
        rows.append({column: values[index] if index < len(values) else "" for index, column in enumerate(header)})
    return header, rows


def get_column_name(header, target):
    for column in header:
        if column == target:
            return column
    target_lower = target.lower()
    for column in header:
        if column.lower() == target_lower:
            return column
    return ""


def add_unique_text(values, value):
    text = str(value or "").strip()
    if text and text not in values:
        values.append(text)


def chamber_line_rows_from_text(content):
    header, raw_rows = read_tab_rows_from_text(content)
    warnings = []
    line_column = get_column_name(header, "line")
    line_code_column = get_column_name(header, "line_code")
    device_column = get_column_name(header, "device")
    missing_columns = [
        name
        for name, column in (
            ("line", line_column),
            ("line_code", line_code_column),
            ("device", device_column),
        )
        if not column
    ]

    if missing_columns:
        warnings.append(f"line_mapping.txt에서 필수 컬럼을 찾지 못했습니다: {', '.join(missing_columns)}")
        return [], len(raw_rows), warnings

    grouped = {}
    for row in raw_rows:
        line_name = str(row.get(line_column, "")).strip()
        if not line_name:
            continue

        current = grouped.setdefault(
            line_name,
            {
                "key": line_name,
                "lineName": line_name,
                "devices": [],
                "lineCodeValues": [],
                "deviceValues": [],
            },
        )
        line_code = str(row.get(line_code_column, "") or "").strip()
        device = str(row.get(device_column, "") or "").strip()
        add_unique_text(current["lineCodeValues"], line_code)
        add_unique_text(current["deviceValues"], device)
        if line_code and device:
            device_key = f"{line_code}::{device}"
            if not any(item["key"] == device_key for item in current["devices"]):
                current["devices"].append({"key": device_key, "lineCode": line_code, "device": device})

    rows = []
    for row in grouped.values():
        rows.append(
            {
                **row,
                "lineCode": ", ".join(row["lineCodeValues"]),
                "device": ", ".join(row["deviceValues"]),
            }
        )
    return rows, len(raw_rows), warnings


def chamber_data_sources(line_code, device):
    line_root = f"{CONFIG['eadsRoot']}/{line_code}"
    device_root = f"{line_root}/{device}"
    return [
        {
            "key": "chamber_met",
            "label": "개별챔버 MET 매핑",
            "path": f"{line_root}/met.txt",
        },
        {
            "key": "chamber_fail",
            "label": "개별챔버 중심치 이상목록",
            "path": f"{device_root}/fail_list.parquet",
        },
        {
            "key": "chamber_std",
            "label": "개별챔버 산포 이상목록",
            "path": f"{device_root}/fail_list_std.parquet",
        },
    ]


def fcc_single_chamber_data_sources(device):
    return [
        {
            "key": "fcc_step_met",
            "label": "FCC 스탭 MET 매핑",
            "path": f"{FCC_STEP_PATH}/met_fcc.txt",
        },
        {
            "key": "fcc_fail",
            "label": "FCC 중심치 이상 목록",
            "path": f"{FCC_STEP_PATH}/fail_list.parquet",
        },
    ]


def command_chamber_lines(_args):
    line_mapping_path = LINE_MAPPING_PATH
    line_mapping_content = read_text_file(line_mapping_path)
    rows, input_row_count, warnings = chamber_line_rows_from_text(line_mapping_content)
    write_json(
        {
            "ok": True,
            "rows": rows,
            "sources": source_status(CHAMBER_DATA_SOURCES),
            "diagnostics": {
                "version": LOADER_VERSION,
                "resolvedPaths": resolved_paths_for_command("chamber-lines", line_mapping_path),
                "inputRows": {"line_mapping": input_row_count},
                "outputRows": len(rows),
                "warnings": warnings,
            },
        }
    )


def command_chamber_summary(args):
    line_code = str(args.line_code or "").strip()
    device = str(args.device or "").strip()
    line_name = str(getattr(args, "line_name", "") or "").strip()
    if not line_code or not device:
        raise ValueError("lineCode와 device가 필요합니다.")

    chamber_sources = chamber_data_sources(line_code, device)
    sources = chamber_sources
    include_fcc_single = should_add_fcc_single_to_chamber(line_name, line_code, device)
    if include_fcc_single:
        sources = sources + fcc_single_chamber_data_sources(device)
    diagnostics = {
        "version": LOADER_VERSION,
        "lineCode": line_code,
        "lineName": line_name,
        "device": device,
        "inputRows": {},
        "columns": {},
        "usedRows": {},
        "outputRows": 0,
        "warnings": [],
    }
    met_source, fail_source, std_source = chamber_sources
    fail_rows = load_optional_parquet(fail_source, diagnostics)
    std_rows = load_optional_parquet(std_source, diagnostics)
    met_rows = load_optional_met_rows(met_source, diagnostics, device=device)

    by_main_step, _by_step_desc = met_lookup(met_rows)
    merged = {}
    key_prefix = f"chamber::{line_code}::{device}::"
    filter_p3d_chamber_eqp = is_p3d_chamber_selection(line_name, line_code, device)
    diagnostics["usedRows"]["fail"] = add_summary_rows(
        merged,
        fail_rows,
        "centerCount",
        by_main_step,
        data_kind="chamber",
        key_prefix=key_prefix,
        filter_cross_line_eqp=filter_p3d_chamber_eqp,
    )
    diagnostics["usedRows"]["std"] = add_summary_rows(
        merged,
        std_rows,
        "stdCount",
        by_main_step,
        data_kind="chamber",
        key_prefix=key_prefix,
        filter_cross_line_eqp=filter_p3d_chamber_eqp,
    )

    if include_fcc_single:
        diagnostics["usedRows"]["fcc_single_fail"] = add_fcc_single_chamber_rows(
            merged,
            device,
            filter_cross_line_eqp=filter_p3d_chamber_eqp,
            diagnostics=diagnostics,
        )
    else:
        diagnostics["usedRows"]["fcc_single_fail"] = 0

    rows = [
        {
            **row,
            "lineName": row.get("lineName") or line_name,
            "lineCode": row.get("lineCode") or line_code,
            "device": row.get("device") or device,
            "chartRoot": row.get("chartRoot") or "chamber",
        }
        for row in merged.values()
        if row["centerCount"] != 0 or row["stdCount"] != 0
    ]
    rows.sort(key=lambda row: (row["mainStep"], row["metStep"]))
    diagnostics["outputRows"] = len(rows)

    if not fail_rows and not std_rows and diagnostics["usedRows"].get("fcc_single_fail", 0) == 0:
        write_json(
            {
                "ok": False,
                "error": "개별챔버 중심치/산포 이상 parquet에서 읽은 행이 없습니다. 파일 경로와 권한을 확인하세요.",
                "config": CONFIG,
                "sources": source_status(sources),
                "diagnostics": diagnostics,
                "rows": [],
            }
        )
        return

    write_json(
        {
            "ok": True,
            "config": CONFIG,
            "sources": source_status(sources),
            "diagnostics": diagnostics,
            "rows": rows,
        }
    )


def strip_percent_prefix(value):
    if "%" in value:
        return value.split("%", 1)[1]
    return value


def is_p4d_eqp(value):
    digits = "".join(ch if ch.isdigit() else " " for ch in str(value)).split()
    return any(token.startswith("35") for token in digits)


def is_p3d_chamber_selection(line_name="", line_code="", device=""):
    normalized_line_name = str(line_name or "").strip().upper()
    normalized_line_code = str(line_code or "").strip().upper()
    if normalized_line_name.startswith("P3D"):
        return True
    return normalized_line_code in {"P3D", "PFB3"}


def should_add_fcc_single_to_chamber(line_name="", line_code="", device=""):
    return is_p3d_chamber_selection(line_name, line_code, device)


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


def sort_frame_desc(dataframe, column):
    if column not in frame_columns(dataframe):
        return dataframe
    if is_polars_frame(dataframe):
        return dataframe.sort(column, descending=True)
    return dataframe.sort_values(column, ascending=False)


def filter_frame_p3d_drawing(dataframe):
    eqp_columns = [column for column in ("eqp_id", "eqpid", "eqp_ch", "eqpch") if column in frame_columns(dataframe)]
    if not eqp_columns:
        return dataframe
    if is_polars_frame(dataframe):
        pl = load_polars()
        expression = None
        for column in eqp_columns:
            condition = (
                pl.col(column)
                .cast(pl.Utf8)
                .str.extract_all(r"\d+")
                .list.eval(pl.element().str.starts_with("35"))
                .list.any()
            )
            expression = condition if expression is None else expression | condition
        return dataframe.filter(~expression)

    mask = None
    for column in eqp_columns:
        condition = dataframe[column].astype(str).apply(is_p4d_eqp)
        mask = condition if mask is None else mask | condition
    return dataframe[~mask]


def filter_frame_eqp(dataframe, eqp_id):
    eqp_columns = [column for column in ("eqp_id", "eqpid", "eqp_ch", "eqpch") if column in frame_columns(dataframe)]
    if not eqp_columns:
        return dataframe
    target_eqp_id = str(eqp_id).strip()
    if is_polars_frame(dataframe):
        pl = load_polars()
        expression = None
        for column in eqp_columns:
            condition = pl.col(column).cast(pl.Utf8).fill_null("").str.strip_chars() == target_eqp_id
            expression = condition if expression is None else expression | condition
        return dataframe.filter(expression)

    mask = None
    for column in eqp_columns:
        condition = dataframe[column].astype(str).str.strip() == target_eqp_id
        mask = condition if mask is None else mask | condition
    return dataframe[mask]


def filter_frame_eqp_ch(dataframe, eqp_id):
    eqp_columns = [column for column in ("eqp_ch", "eqpch") if column in frame_columns(dataframe)]
    if not eqp_columns:
        return dataframe.head(0)
    target_eqp_id = str(eqp_id).strip()
    if is_polars_frame(dataframe):
        pl = load_polars()
        expression = None
        for column in eqp_columns:
            condition = pl.col(column).cast(pl.Utf8).fill_null("").str.strip_chars() == target_eqp_id
            expression = condition if expression is None else expression | condition
        return dataframe.filter(expression)

    mask = None
    for column in eqp_columns:
        condition = dataframe[column].astype(str).str.strip() == target_eqp_id
        mask = condition if mask is None else mask | condition
    return dataframe[mask] if mask is not None else dataframe.head(0)


def exclude_frame_eqp(dataframe, eqp_id):
    eqp_columns = [column for column in ("eqp_id", "eqpid", "eqp_ch", "eqpch") if column in frame_columns(dataframe)]
    if not eqp_columns:
        return dataframe
    target_eqp_id = str(eqp_id).strip()
    if is_polars_frame(dataframe):
        pl = load_polars()
        expression = None
        for column in eqp_columns:
            condition = pl.col(column).cast(pl.Utf8).fill_null("").str.strip_chars() != target_eqp_id
            expression = condition if expression is None else expression & condition
        return dataframe.filter(expression)

    mask = None
    for column in eqp_columns:
        condition = dataframe[column].astype(str).str.strip() != target_eqp_id
        mask = condition if mask is None else mask & condition
    return dataframe[mask]


def normalize_pm_equipment(value):
    return str(value or "").strip().replace("-", "_")


def filter_pm_frame_eqp(dataframe, eqp_id):
    columns = frame_columns(dataframe)
    target_eqp_id = normalize_pm_equipment(eqp_id)
    if not target_eqp_id:
        return dataframe.head(0)

    if is_polars_frame(dataframe):
        pl = load_polars()
        expression = None
        for column in PM_EQUIPMENT_COLUMNS:
            if column not in columns:
                continue
            condition = (
                pl.col(column)
                .cast(pl.Utf8)
                .fill_null("")
                .str.strip_chars()
                .str.replace_all("-", "_")
                == target_eqp_id
            )
            expression = condition if expression is None else expression | condition
        if "asset" in columns:
            condition = (
                pl.col("asset")
                .cast(pl.Utf8)
                .fill_null("")
                .str.strip_chars()
                .str.replace_all("-", "_")
                .str.contains(target_eqp_id, literal=True)
            )
            expression = condition if expression is None else expression | condition
        return dataframe.filter(expression) if expression is not None else dataframe.head(0)

    mask = None
    for column in PM_EQUIPMENT_COLUMNS:
        if column not in columns:
            continue
        condition = dataframe[column].astype(str).str.strip().str.replace("-", "_", regex=False) == target_eqp_id
        mask = condition if mask is None else mask | condition
    if "asset" in columns:
        condition = dataframe["asset"].astype(str).str.strip().str.replace("-", "_", regex=False).str.contains(target_eqp_id, regex=False, na=False)
        mask = condition if mask is None else mask | condition
    return dataframe[mask] if mask is not None else dataframe.head(0)


def select_existing_frame_columns(dataframe, columns):
    return select_frame_columns(dataframe, [column for column in columns if column in frame_columns(dataframe)])


def select_frame_columns(dataframe, columns):
    existing = [column for column in columns if column in frame_columns(dataframe)]
    if is_polars_frame(dataframe):
        return dataframe.select(existing)
    return dataframe[existing]


def rename_frame_column(dataframe, source, target):
    columns = frame_columns(dataframe)
    if source not in columns or target in columns:
        return dataframe
    if is_polars_frame(dataframe):
        return dataframe.rename({source: target})
    return dataframe.rename(columns={source: target})


def normalize_fcc_chart_frame(dataframe):
    return rename_frame_column(dataframe, "defect_value", "fab_value")


def split_p3d_drawing_df(dataframe):
    return filter_frame_p3d_drawing(dataframe)


def split_fcc_drawing_df(dataframe):
    return filter_frame_p3d_drawing(normalize_fcc_chart_frame(dataframe))


def timefit_fcc_drawing_df(dataframe):
    return normalize_fcc_chart_frame(dataframe)


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


def met_lookup(met_rows, step_normalizer=normalize_step):
    by_main_step = []
    by_step_desc = {}
    for row in met_rows:
        main_step = step_normalizer(row.get("main_step") or "")
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


def add_summary_rows(
    target,
    source_rows,
    count_key,
    by_main_step,
    main_columns=("main_seq", "대상스탭", "main_step", "mainStep"),
    met_columns=("met_seq", "계측스탭", "met_step", "metStep"),
    eqp_columns=("eqpid", "eqpch", "eqp_ch", "eqp_id", "eqpIds", "eqp_ids"),
    data_kind="",
    key_prefix="",
    filter_cross_line_eqp=True,
    allowed_keys=None,
    step_normalizer=normalize_step,
):
    eqp_ids_key = "centerEqpIds" if count_key == "centerCount" else "stdEqpIds"

    added = 0
    for row in source_rows:
        main_step_raw = str(get_first(row, main_columns) or "").strip()
        met_step_raw = str(get_first(row, met_columns) or "").strip()
        main_step = step_normalizer(main_step_raw)
        met_step = step_normalizer(met_step_raw)
        if not main_step or not met_step:
            continue

        key = f"{key_prefix}{main_step}::{met_step}"
        if allowed_keys is not None and key not in allowed_keys:
            continue
        step_desc, sdwt = find_step_desc(main_step, by_main_step)
        eqp_ids = parse_eqp_ids(get_first(row, eqp_columns))
        if filter_cross_line_eqp and ((CONFIG["selectLine"] == "PFB3" and CONFIG["device"] == "D1c") or CONFIG["selectLine"] == "P4D"):
            eqp_ids = [eqp_id for eqp_id in eqp_ids if not is_p4d_eqp(eqp_id)]
        if not eqp_ids:
            continue

        initial_row = {
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
            "centerEqpIds": [],
            "stdEqpIds": [],
            "eqpIds": [],
        }
        if data_kind:
            initial_row["dataKind"] = data_kind

        current = target.setdefault(key, initial_row)

        if step_desc and not current["stepDesc"]:
            current["stepDesc"] = step_desc
        if sdwt and not current["sdwt"]:
            current["sdwt"] = sdwt

        current[eqp_ids_key] = sorted(set(current[eqp_ids_key]) | set(eqp_ids))
        current[count_key] = len(current[eqp_ids_key])
        current["eqpIds"] = sorted(set(current["eqpIds"]) | set(eqp_ids))
        added += 1

    return added


def normalize_draw_category(row):
    value = get_first(row, ("draw_category", "drawCategory", "draw category"))
    if is_missing_value(value):
        return ""
    return str(value or "").strip().lower()


def is_fcc_single_draw_row(row):
    return normalize_draw_category(row) == FCC_DRAW_CATEGORY_SINGLE


def add_fcc_met_rows(target, met_rows, key_prefix="fcc", chart_root="step", source_priority=1):
    added = 0
    for row in met_rows:
        main_step_raw = str(row.get("main_step") or "").strip()
        met_step_raw = str(row.get("met_step") or "").strip()
        main_step = fcc_mapping_step_code(main_step_raw)
        met_step = fcc_mapping_step_code(met_step_raw)
        if not main_step or not met_step:
            continue

        key = f"{key_prefix}::{main_step}::{met_step}"
        if key in target:
            continue

        target[key] = {
            "key": key,
            "dataKind": "fcc",
            "chartRoot": chart_root,
            "sourcePriority": source_priority,
            "mainStep": main_step,
            "mainStepPath": main_step_raw or main_step,
            "stepSeq": main_step,
            "metStep": met_step,
            "metStepPath": met_step_raw or met_step,
            "drawCategory": normalize_draw_category(row),
            "metItem": fcc_met_item(row),
            "metItem2": fcc_met_item2(row),
            "stepDesc": row.get("step_desc") or "",
            "sdwt": row.get("sdwt") or "",
            "centerCount": 0,
            "stdCount": 0,
            "centerEqpIds": [],
            "stdEqpIds": [],
            "eqpIds": [],
        }
        added += 1

    return added


def fcc_met_mapping_index(met_rows):
    by_key = {}
    by_main_step = {}

    for row in met_rows:
        main_step_raw = str(row.get("main_step") or "").strip()
        met_step_raw = str(row.get("met_step") or "").strip()
        main_step = fcc_mapping_step_code(main_step_raw)
        met_step = fcc_mapping_step_code(met_step_raw)
        if not main_step or not met_step:
            continue

        entry = {
            "mainStep": main_step,
            "mainStepPath": main_step_raw or main_step,
            "metStep": met_step,
            "metStepPath": met_step_raw or met_step,
            "drawCategory": normalize_draw_category(row),
            "metItem": fcc_met_item(row),
            "metItem2": fcc_met_item2(row),
            "stepDesc": row.get("step_desc") or "",
            "sdwt": row.get("sdwt") or "",
        }
        by_key[(main_step, met_step)] = entry
        by_main_step.setdefault(main_step, []).append(entry)

    return by_key, by_main_step


def add_fcc_summary_rows(
    target,
    source_rows,
    count_key,
    by_main_step,
    mapped_keys,
    eqp_columns,
    key_prefix="fcc",
    chart_root="step",
    source_priority=1,
    required_eqp_ids=None,
    met_mapping_by_key=None,
    met_mapping_by_main_step=None,
    use_mapping_met_step=False,
    filter_cross_line_eqp=False,
):
    eqp_ids_key = "centerEqpIds" if count_key == "centerCount" else "stdEqpIds"

    added = 0
    for row in source_rows:
        main_step_raw = str(get_first(row, ("main_seq", "main_step", "mainStep")) or "").strip()
        met_seq_raw = str(get_first(row, ("met_seq", "met_step", "metStep")) or "").strip()
        main_step = fcc_mapping_step_code(main_step_raw)
        fail_met_step = fcc_mapping_step_code(met_seq_raw)
        fail_item_id = fcc_item_id_from_met_seq(met_seq_raw)
        if not main_step or not fail_met_step:
            continue

        mapped_entry = (met_mapping_by_key or {}).get((main_step, fail_met_step))
        if use_mapping_met_step:
            candidates = (met_mapping_by_main_step or {}).get(main_step, [])
            if mapped_entry is None and len(candidates) == 1:
                mapped_entry = candidates[0]
            if mapped_entry is None:
                continue

        met_step = mapped_entry["metStep"] if use_mapping_met_step and mapped_entry else fail_met_step
        mapping_key = f"{key_prefix}::{main_step}::{met_step}"
        if mapping_key not in mapped_keys:
            continue

        item_id = fail_item_id
        if not item_id:
            continue
        met_item2 = mapped_entry.get("metItem2", "") if mapped_entry else ""

        met_seq = f"{met_step}_{item_id}"
        key = f"{key_prefix}::{main_step}::{met_seq}"
        step_desc, sdwt = find_step_desc(main_step, by_main_step)
        if mapped_entry:
            step_desc = mapped_entry["stepDesc"] or step_desc
            sdwt = mapped_entry["sdwt"] or sdwt
            if use_mapping_met_step:
                main_step_raw = mapped_entry["mainStepPath"]
        met_seq_raw = met_seq
        eqp_ids = parse_eqp_ids(get_first(row, eqp_columns))
        if required_eqp_ids is not None:
            eqp_ids = [eqp_id for eqp_id in eqp_ids if eqp_id in required_eqp_ids]
        if filter_cross_line_eqp:
            eqp_ids = [eqp_id for eqp_id in eqp_ids if not is_p4d_eqp(eqp_id)]
        if not eqp_ids:
            continue

        current = target.setdefault(
            key,
            {
                "key": key,
                "dataKind": "fcc",
                "chartRoot": chart_root,
                "sourcePriority": source_priority,
                "mainStep": main_step,
                "mainStepPath": main_step_raw or main_step,
                "stepSeq": main_step,
                "metStep": met_seq,
                "metStepPath": met_seq_raw or met_seq,
                "drawCategory": mapped_entry.get("drawCategory", "") if mapped_entry else "",
                "metItem": item_id,
                "metItem2": met_item2,
                "stepDesc": step_desc,
                "sdwt": sdwt,
                "centerCount": 0,
                "stdCount": 0,
                "centerEqpIds": [],
                "stdEqpIds": [],
                "eqpIds": [],
            },
        )

        if main_step_raw:
            current["mainStepPath"] = main_step_raw
        if met_seq_raw:
            current["metStepPath"] = met_seq_raw
        if item_id:
            current["metItem"] = item_id
        if met_item2:
            current["metItem2"] = met_item2
        if step_desc and not current["stepDesc"]:
            current["stepDesc"] = step_desc
        if sdwt and not current["sdwt"]:
            current["sdwt"] = sdwt
        current["sourcePriority"] = min(current.get("sourcePriority", source_priority), source_priority)

        current[eqp_ids_key] = sorted(set(current[eqp_ids_key]) | set(eqp_ids))
        current[count_key] = len(current[eqp_ids_key])
        current["eqpIds"] = sorted(set(current["eqpIds"]) | set(eqp_ids))
        added += 1

    return added


def collect_eqp_ids(rows, eqp_columns=("eqpid", "eqpch", "eqp_ch")):
    eqp_ids = set()
    for row in rows:
        eqp_ids.update(parse_eqp_ids(get_first(row, eqp_columns)))
    return eqp_ids


def add_fcc_single_chamber_rows(target, device, filter_cross_line_eqp=True, diagnostics=None):
    diagnostics = diagnostics if diagnostics is not None else {}
    fcc_step_met_source, fcc_fail_source = fcc_single_chamber_data_sources(device)
    fcc_met_rows = load_optional_met_rows(fcc_step_met_source, diagnostics, device=None)
    fcc_fail_rows = load_optional_parquet(fcc_fail_source, diagnostics)

    single_met_rows = [row for row in fcc_met_rows if is_fcc_single_draw_row(row)]
    diagnostics.setdefault("usedRows", {})["fcc_single_met"] = len(single_met_rows)
    if not single_met_rows or not fcc_fail_rows:
        return 0

    single_rows = {}
    by_main_step, _by_step_desc = met_lookup(single_met_rows, step_normalizer=fcc_mapping_step_code)
    fcc_single_by_key, _fcc_single_by_main_step = fcc_met_mapping_index(single_met_rows)
    diagnostics.setdefault("usedRows", {})["fcc_single_met_rows"] = add_fcc_met_rows(
        single_rows,
        single_met_rows,
        key_prefix="fcc_single",
        chart_root="step",
        source_priority=1,
    )
    diagnostics.setdefault("usedRows", {})["fcc_single_fail_candidates"] = add_fcc_summary_rows(
        single_rows,
        fcc_fail_rows,
        "centerCount",
        by_main_step,
        set(single_rows),
        eqp_columns=("eqpid", "eqpch", "eqp_ch"),
        key_prefix="fcc_single",
        chart_root="step",
        source_priority=1,
        met_mapping_by_key=fcc_single_by_key,
    )

    added = 0
    for row in single_rows.values():
        if row["centerCount"] == 0:
            continue

        if filter_cross_line_eqp:
            row["centerEqpIds"] = [eqp_id for eqp_id in row["centerEqpIds"] if not is_p4d_eqp(eqp_id)]
            row["eqpIds"] = [eqp_id for eqp_id in row["eqpIds"] if not is_p4d_eqp(eqp_id)]
            row["centerCount"] = len(row["centerEqpIds"])
        if row["centerCount"] == 0:
            continue

        target[row["key"]] = {
            **row,
            "dataKind": "fcc",
            "anomalySource": "fcc_single",
            "drawCategory": FCC_DRAW_CATEGORY_SINGLE,
            "suppressExtraCharts": True,
            "lineCode": FCC_SINGLE_CHAMBER_LINE_CODE,
            "device": device,
        }
        added += 1

    return added


def fcc_met_item(row):
    return normalize_item_id(row.get("met_item") or "")


def fcc_met_item2(row):
    value = get_first(row, ("met_item2", "metItem2"))
    if is_missing_value(value):
        return ""
    return str(value or "").strip()


def fcc_met_unique_counts(met_rows):
    main_steps = set()
    met_steps = set()
    for row in met_rows:
        main_step = fcc_mapping_step_code(str(row.get("main_step") or "").strip())
        met_step = fcc_mapping_step_code(str(row.get("met_step") or "").strip())
        if main_step:
            main_steps.add(main_step)
        if met_step:
            met_steps.add(met_step)
    return {
        "extraMetMainStepCount": len(main_steps),
        "extraMetStepCount": len(met_steps),
    }


def fcc_timefit_eqp_stats(timefit_rows):
    by_main_step_met_step = {}
    for row in timefit_rows:
        main_step = fcc_mapping_step_code(fcc_timefit_main_seq(row))
        met_step = fcc_mapping_step_code(fcc_timefit_step_seq(row))
        eqp_ids = fcc_timefit_eqp_ids(row)
        if not main_step or not met_step or not eqp_ids:
            continue

        current = by_main_step_met_step.setdefault(
            (main_step, met_step),
            {
                "eqpCounts": {},
                "count": 0,
                "mainStep": main_step,
                "metStep": met_step,
            },
        )
        for eqp_id in eqp_ids:
            current["eqpCounts"][eqp_id] = current["eqpCounts"].get(eqp_id, 0) + 1
        current["count"] += 1

    return by_main_step_met_step


def apply_fcc_timefit_stats(rows, timefit_rows):
    stats_by_main_step_met_step = fcc_timefit_eqp_stats(timefit_rows)
    matched_rows = 0
    matched_anomaly_count = 0

    for row in rows:
        main_step = row.get("mainStep")
        met_step = fcc_mapping_step_code(row.get("metStep"))
        stats = stats_by_main_step_met_step.get((main_step, met_step))
        if not stats:
            row["timefitCount"] = 0
            row["timefitEqpIds"] = []
            row["timefitEqpCounts"] = {}
            continue

        eqp_counts = dict(sorted(stats["eqpCounts"].items()))
        timefit_eqp_ids = list(eqp_counts)
        row["timefitCount"] = stats["count"]
        row["timefitEqpIds"] = timefit_eqp_ids
        row["timefitEqpCounts"] = eqp_counts
        row["eqpIds"] = sorted(set(row.get("eqpIds", [])) | set(timefit_eqp_ids))
        matched_rows += 1
        matched_anomaly_count += stats["count"]

    return {
        "mainStepCount": len({stats["mainStep"] for stats in stats_by_main_step_met_step.values()}),
        "metStepCount": len(stats_by_main_step_met_step),
        "eqpCount": len({eqp_id for stats in stats_by_main_step_met_step.values() for eqp_id in stats["eqpCounts"]}),
        "anomalyCount": sum(stats["count"] for stats in stats_by_main_step_met_step.values()),
        "matchedRows": matched_rows,
        "matchedAnomalyCount": matched_anomaly_count,
    }


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


def load_optional_met_rows(source, diagnostics, device=CONFIG["device"]):
    try:
        rows = read_met_rows(source["path"], device=device)
        diagnostics["inputRows"][source["key"]] = len(rows)
        diagnostics["columns"][source["key"]] = list(rows[0].keys()) if rows else []
        return rows
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
    met_rows = load_optional_met_rows(DATA_SOURCES[3], diagnostics)

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


def command_fcc_summary(_args):
    diagnostics = {
        "version": LOADER_VERSION,
        "inputRows": {},
        "columns": {},
        "usedRows": {},
        "outputRows": 0,
        "warnings": [],
    }
    fcc_step_met_source = next(source for source in FCC_DATA_SOURCES if source["key"] == "fcc_step_met")
    fcc_fail_source = next(source for source in FCC_DATA_SOURCES if source["key"] == "fcc_fail")
    fcc_extra_met_source = next(source for source in FCC_DATA_SOURCES if source["key"] == "fcc_extra_met")
    fcc_extra_fail_source = next(source for source in FCC_DATA_SOURCES if source["key"] == "fcc_extra_fail")
    fcc_extra_std_source = next(source for source in FCC_DATA_SOURCES if source["key"] == "fcc_extra_std")
    fcc_timefit_fail_list_source = next(source for source in FCC_DATA_SOURCES if source["key"] == "fcc_timefit_fail_list")
    fail_rows = load_optional_parquet(fcc_fail_source, diagnostics)
    met_rows = load_optional_met_rows(fcc_step_met_source, diagnostics, device=None)
    extra_fail_rows = load_optional_parquet(fcc_extra_fail_source, diagnostics)
    extra_std_rows = load_optional_parquet(fcc_extra_std_source, diagnostics)
    extra_met_rows = load_optional_met_rows(fcc_extra_met_source, diagnostics, device=None)
    timefit_rows = load_optional_parquet(fcc_timefit_fail_list_source, diagnostics)
    display_met_rows = [row for row in met_rows if not is_fcc_single_draw_row(row)]

    by_main_step, _by_step_desc = met_lookup(display_met_rows, step_normalizer=fcc_mapping_step_code)
    fcc_step_met_by_key, _fcc_step_met_by_main_step = fcc_met_mapping_index(display_met_rows)
    fcc_center_eqp_ids = {
        eqp_id
        for eqp_id in collect_eqp_ids(fail_rows, ("eqpid", "eqpch", "eqp_ch"))
        if not is_p4d_eqp(eqp_id)
    }
    metrics = {
        **fcc_met_unique_counts(extra_met_rows),
        "centerEqpCount": len(fcc_center_eqp_ids),
    }
    merged = {}
    diagnostics["usedRows"]["fcc_step_met"] = add_fcc_met_rows(
        merged,
        display_met_rows,
        key_prefix="fcc_step",
        chart_root="step",
        source_priority=1,
    )
    diagnostics["usedRows"]["fcc_step_met_single_excluded"] = len(met_rows) - len(display_met_rows)
    mapped_keys = set(merged)
    diagnostics["usedRows"]["fcc_fail"] = add_fcc_summary_rows(
        merged,
        fail_rows,
        "centerCount",
        by_main_step,
        mapped_keys,
        eqp_columns=("eqpid", "eqpch", "eqp_ch"),
        key_prefix="fcc_step",
        chart_root="step",
        source_priority=1,
        met_mapping_by_key=fcc_step_met_by_key,
        filter_cross_line_eqp=True,
    )
    diagnostics["usedRows"]["fcc_extra_met"] = len(extra_met_rows)
    diagnostics["usedRows"]["fcc_extra_fail"] = sum(
        1
        for row in extra_fail_rows
        if set(parse_eqp_ids(get_first(row, ("eqpid", "eqpch", "eqp_ch")))) & fcc_center_eqp_ids
    )
    diagnostics["usedRows"]["fcc_extra_std"] = sum(
        1
        for row in extra_std_rows
        if set(parse_eqp_ids(get_first(row, ("eqpid", "eqpch", "eqp_ch")))) & fcc_center_eqp_ids
    )

    rows = [
        row
        for row in merged.values()
        if row["centerCount"] != 0
    ]
    timefit_stats = apply_fcc_timefit_stats(rows, timefit_rows)
    diagnostics["usedRows"]["fcc_timefit_fail_list_main_steps"] = timefit_stats["mainStepCount"]
    diagnostics["usedRows"]["fcc_timefit_fail_list_main_met_steps"] = timefit_stats["metStepCount"]
    diagnostics["usedRows"]["fcc_timefit_fail_list_matched_rows"] = timefit_stats["matchedRows"]
    diagnostics["usedRows"]["fcc_timefit_fail_list_matched_anomalies"] = timefit_stats["matchedAnomalyCount"]
    rows.sort(key=lambda row: (row["mainStep"], row["metStep"]))
    diagnostics["outputRows"] = len(rows)
    metrics["centerEqpCount"] = len({eqp_id for row in rows for eqp_id in row.get("centerEqpIds", [])})
    metrics["timefitMainStepCount"] = timefit_stats["mainStepCount"]
    metrics["timefitEqpCount"] = timefit_stats["eqpCount"]
    metrics["timefitAnomalyCount"] = timefit_stats["anomalyCount"]

    if not met_rows and not fail_rows and not extra_met_rows and not extra_fail_rows and not extra_std_rows and not timefit_rows:
        write_json(
            {
                "ok": False,
                "error": "FCC 스탭 MET/중심치, FCC 추가 또는 FCC 이상시점 파일에서 읽은 행이 없습니다. 파일 경로, 권한, 입력 컬럼을 확인하세요.",
                "config": CONFIG,
                "sources": source_status(FCC_DATA_SOURCES),
                "diagnostics": diagnostics,
                "metrics": metrics,
                "rows": [],
            }
        )
        return

    write_json(
        {
            "ok": True,
            "config": CONFIG,
            "sources": source_status(FCC_DATA_SOURCES),
            "diagnostics": diagnostics,
            "metrics": metrics,
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


def generic_item_id_from_met_step(value):
    text = strip_main_suffix(normalize_step(value)).strip()
    if "_" not in text:
        return ""
    item_id = text.split("_", 1)[1].split("_", 1)[0].strip()
    digits = "".join(char for char in item_id if char.isdigit())
    return digits or item_id


def resolve_chamber_chart_paths(line_code, device, main_step, chart_met_step):
    line_code = str(line_code or "").strip()
    device = str(device or "").strip()
    if not line_code or not device:
        raise ValueError("개별챔버 chart 경로에 필요한 lineCode/device가 없습니다.")

    root_path = f"{CONFIG['eadsRoot']}/{line_code}/{device}"
    main_candidates = unique_nonempty([main_step, normalize_step(main_step)])
    main_dir, main_dir_name, main_attempts = resolve_child_dir(root_path, main_candidates, "chamber main_step")

    met_candidates = unique_nonempty([normalize_step(chart_met_step), chart_met_step])
    met_dir, met_dir_name, met_attempts = resolve_child_dir(main_dir, met_candidates, "chamber met_step", is_met=True)

    latest_date = latest_child_dir(met_dir)
    data_dir = os.path.join(met_dir, latest_date)
    main_file_candidates = unique_nonempty([main_dir_name, main_step, normalize_step(main_step)])
    all_path, all_attempts = resolve_parquet_file(data_dir, "all", main_file_candidates)
    fail_path, fail_attempts = resolve_parquet_file(data_dir, "fail", main_file_candidates)
    try:
        std_path, std_attempts = resolve_parquet_file(data_dir, "fail_std", main_file_candidates)
    except FileNotFoundError:
        std_path = None
        std_attempts = [f"fail_std_{candidate}.parquet" for candidate in main_file_candidates]

    return {
        "rootPath": root_path,
        "mainDir": main_dir,
        "metDir": met_dir,
        "dataDir": data_dir,
        "latestDate": latest_date,
        "allPath": all_path,
        "failPath": fail_path,
        "stdPath": std_path,
        "requested": {
            "lineCode": line_code,
            "device": device,
            "mainStep": main_step,
            "chartMetStep": chart_met_step,
        },
        "resolved": {
            "lineCode": line_code,
            "device": device,
            "mainStep": main_dir_name,
            "chartMetStep": met_dir_name,
            "itemId": generic_item_id_from_met_step(chart_met_step),
        },
        "attempts": {
            "mainDirs": main_attempts,
            "metDirs": met_attempts,
            "allFiles": all_attempts,
            "failFiles": fail_attempts,
            "stdFiles": std_attempts,
        },
    }


MANAGEMENT_RANDOM_PC_ITEM_ID = "RANDOM_PC"


def resolve_chamber_all_chart_paths(line_code, device, main_step, chart_met_step):
    line_code = str(line_code or "").strip()
    device = str(device or "").strip()
    if not line_code or not device:
        raise ValueError("관리 STEP chart 경로에 필요한 lineCode/device가 없습니다.")

    root_path = f"{CONFIG['eadsRoot']}/{line_code}/{device}"
    main_candidates = unique_nonempty([main_step, normalize_step(main_step)])
    main_dir, main_dir_name, main_attempts = resolve_child_dir(root_path, main_candidates, "management main_step")

    met_candidates = unique_nonempty([normalize_step(chart_met_step)])
    met_dir, met_dir_name, met_attempts = resolve_child_dir(main_dir, met_candidates, "management met_step", is_met=True)

    latest_date = latest_child_dir(met_dir)
    data_dir = os.path.join(met_dir, latest_date)
    main_file_candidates = unique_nonempty([main_dir_name, main_step, normalize_step(main_step)])
    all_path, all_attempts = resolve_parquet_file(data_dir, "all", main_file_candidates)

    return {
        "rootPath": root_path,
        "mainDir": main_dir,
        "metDir": met_dir,
        "dataDir": data_dir,
        "latestDate": latest_date,
        "allPath": all_path,
        "failPath": None,
        "stdPath": None,
        "requested": {
            "lineCode": line_code,
            "device": device,
            "mainStep": main_step,
            "chartMetStep": chart_met_step,
            "itemId": MANAGEMENT_RANDOM_PC_ITEM_ID,
        },
        "resolved": {
            "lineCode": line_code,
            "device": device,
            "mainStep": main_dir_name,
            "chartMetStep": met_dir_name,
            "itemId": MANAGEMENT_RANDOM_PC_ITEM_ID,
        },
        "attempts": {
            "mainDirs": main_attempts,
            "metDirs": met_attempts,
            "allFiles": all_attempts,
            "failFiles": [],
            "stdFiles": [],
        },
    }


def strip_fcc_prefix(value):
    value = str(value or "").strip()
    return value[4:] if value.lower().startswith("fcc_") else value


def fcc_mapping_step_code(value):
    text = strip_fcc_prefix(strip_main_suffix(normalize_step(value))).strip()
    head = text.split("_", 1)[0]
    digits = "".join(char for char in head if char.isdigit())
    if len(digits) >= 6:
        return digits[-6:]
    return digits or head


def fcc_item_id_from_met_seq(value):
    text = strip_fcc_prefix(strip_main_suffix(normalize_step(value))).strip()
    if "_" not in text:
        return ""
    return text.split("_", 1)[1].strip()


def normalize_item_id(value):
    if is_missing_value(value):
        return ""
    text = str(value or "").strip()
    digits = "".join(char for char in text if char.isdigit())
    return digits or text


def fcc_met_step_match_parts(value):
    return fcc_mapping_step_code(value), normalize_item_id(fcc_item_id_from_met_seq(value))


def fcc_timefit_step_seq(row):
    return str(get_first(row, ("fcc_step_seq", "fccStepSeq", "fcc_step", "fccStep")) or "").strip()


def fcc_timefit_main_seq(row):
    return str(get_first(row, ("main_seq", "mainStep", "main_step")) or "").strip()


def fcc_timefit_met_seq(row):
    return str(get_first(row, ("met_seq", "metStep", "met_step")) or "").strip()


def fcc_timefit_eqp_ids(row):
    return parse_eqp_ids(get_first(row, ("eqpid", "eqpch", "eqp_ch", "eqp_id")))


def fcc_timefit_matches_met_step(row, chart_met_step):
    timefit_met_step = fcc_mapping_step_code(fcc_timefit_step_seq(row))
    chart_met_step_code = fcc_mapping_step_code(chart_met_step)
    return bool(timefit_met_step and chart_met_step_code and timefit_met_step == chart_met_step_code)


def clean_text(value):
    if is_missing_value(value):
        return ""
    return str(value or "").strip()


def item_desc_for_item_id(dataframe, item_id):
    columns = frame_columns(dataframe)
    if "item_desc" not in columns:
        return ""

    descriptions = column_values(dataframe, "item_desc")
    if "item_id" in columns:
        target = normalize_item_id(item_id)
        for current_item_id, description in zip(column_values(dataframe, "item_id"), descriptions):
            if normalize_item_id(current_item_id) != target:
                continue
            text = clean_text(description)
            if text:
                return text
        return ""

    unique_descriptions = unique_nonempty(clean_text(description) for description in descriptions)
    return unique_descriptions[0] if len(unique_descriptions) == 1 else ""


def fcc_item_id_for_met_seq(met_seq):
    item_id = fcc_item_id_from_met_seq(met_seq)
    if not item_id:
        met_step_code = fcc_mapping_step_code(met_seq)
        raise ValueError(f"FCC met_seq {met_seq}에서 item_id를 찾지 못했습니다. 예: {met_step_code}_26")
    return item_id


def resolve_fcc_met_dir(main_dir, met_candidates, item_id, chart_root):
    try:
        return resolve_child_dir(main_dir, met_candidates, "fcc met_step", is_met=True)
    except FileNotFoundError:
        if chart_root != "root":
            raise

        children = list_child_dirs(main_dir)
        item_suffix = f"_{str(item_id).lower()}"
        fallback_matches = [
            child
            for child in children
            if normalize_dir_key(child, is_met=True).endswith(item_suffix)
        ]
        if not fallback_matches:
            raise

        fallback_name = fallback_matches[0]
        attempts = [os.path.join(main_dir, candidate) for candidate in met_candidates]
        attempts.extend(os.path.join(main_dir, match) for match in fallback_matches)
        return os.path.join(main_dir, fallback_name), fallback_name, attempts


def resolve_fcc_chart_paths(main_step, chart_met_step, chart_root="step", require_fail=True, resolve_std=True, require_std=False):
    main_step_code = fcc_mapping_step_code(main_step)
    met_step_code = fcc_mapping_step_code(chart_met_step)
    if not main_step_code or not met_step_code:
        raise ValueError(f"FCC chart 경로에 필요한 main_step/met_step이 없습니다: {main_step}, {chart_met_step}")

    item_id = fcc_item_id_for_met_seq(chart_met_step)
    root_path = FCC_FOLDER_PATH if chart_root == "root" else FCC_STEP_PATH
    main_candidates = unique_nonempty([f"U%{main_step_code}", main_step, main_step_code])
    main_dir, main_dir_name, main_attempts = resolve_child_dir(root_path, main_candidates, "fcc main_step")
    met_candidates = unique_nonempty([f"{met_step_code}_{item_id}"])
    met_dir, met_dir_name, met_attempts = resolve_fcc_met_dir(main_dir, met_candidates, item_id, chart_root)
    latest_date = latest_child_dir(met_dir)
    data_dir = os.path.join(met_dir, latest_date)
    file_candidates = unique_nonempty([f"U%{main_step_code}", main_dir_name, main_step])
    all_path, all_attempts = resolve_parquet_file(data_dir, "all", file_candidates)
    try:
        fail_path, fail_attempts = resolve_parquet_file(data_dir, "fail", file_candidates)
    except FileNotFoundError:
        if require_fail:
            raise
        fail_path = None
        fail_attempts = [f"fail_{candidate}.parquet" for candidate in file_candidates]
    if resolve_std:
        try:
            std_path, std_attempts = resolve_parquet_file(data_dir, "fail_std", file_candidates)
        except FileNotFoundError:
            if require_std:
                raise
            std_path = None
            std_attempts = [f"fail_std_{candidate}.parquet" for candidate in file_candidates]
    else:
        std_path = None
        std_attempts = []

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
            "chartRoot": chart_root,
        },
        "resolved": {
            "mainStep": main_dir_name,
            "chartMetStep": met_dir_name,
            "mainStepCode": main_step_code,
            "metStepCode": met_step_code,
            "itemId": item_id,
        },
        "attempts": {
            "mainDirs": main_attempts,
            "metDirs": met_attempts,
            "allFiles": all_attempts,
            "failFiles": fail_attempts,
            "stdFiles": std_attempts,
        },
    }


def fcc_file_token(value):
    return str(value or "").strip().replace("/", "_").replace("\\", "_")


def resolve_fcc_timefit_chart_paths(main_step, chart_met_step, eqp_ch):
    main_step_code = fcc_mapping_step_code(main_step)
    met_step_code = fcc_mapping_step_code(chart_met_step)
    eqp_ch_token = fcc_file_token(eqp_ch)
    if not main_step_code or not met_step_code or not eqp_ch_token:
        raise ValueError(f"FCC 이상시점 chart 경로에 필요한 main_step/met_step/eqp_ch가 없습니다: {main_step}, {chart_met_step}, {eqp_ch}")

    item_id = fcc_item_id_for_met_seq(chart_met_step)
    main_candidates = unique_nonempty([f"U%{main_step_code}", main_step, main_step_code])
    main_dir, main_dir_name, main_attempts = resolve_child_dir(FCC_TIMEFIT_PATH, main_candidates, "fcc timefit main_step")
    met_candidates = unique_nonempty([f"{met_step_code}_{item_id}"])
    met_dir, met_dir_name, met_attempts = resolve_fcc_met_dir(main_dir, met_candidates, item_id, "root")
    latest_date = latest_child_dir(met_dir)
    data_dir = os.path.join(met_dir, latest_date)
    file_candidates = unique_nonempty([f"U%{main_step_code}", main_dir_name, main_step])
    all_path, all_attempts = resolve_parquet_file(data_dir, f"all_fccdate_{eqp_ch_token}", file_candidates)
    fail_path, fail_attempts = resolve_parquet_file(data_dir, f"fail_fccdate_{eqp_ch_token}", file_candidates)

    return {
        "mainDir": main_dir,
        "metDir": met_dir,
        "dataDir": data_dir,
        "latestDate": latest_date,
        "allPath": all_path,
        "failPath": fail_path,
        "stdPath": None,
        "requested": {
            "mainStep": main_step,
            "chartMetStep": chart_met_step,
            "chartRoot": "timefit",
            "eqpCh": eqp_ch,
        },
        "resolved": {
            "mainStep": main_dir_name,
            "chartMetStep": met_dir_name,
            "mainStepCode": main_step_code,
            "metStepCode": met_step_code,
            "itemId": item_id,
            "eqpCh": eqp_ch_token,
        },
        "attempts": {
            "mainDirs": main_attempts,
            "metDirs": met_attempts,
            "allFiles": all_attempts,
            "failFiles": fail_attempts,
            "stdFiles": [],
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
        "eqpch",
        "eqp_id",
        "eqpid",
        "item_id",
        "item_desc",
        "ppid",
        "ppid_right",
        "final_decision",
        "FINAL_DECISION",
        "std_result",
        "STD_RESULT",
    ]
    return select_frame_columns(dataframe, wanted)


PPID_COLUMNS = ("ppid", "ppid_right")
PPID_LOOKUP_COLUMN_GROUPS = (
    ("tkout_time_ms", "tkout_time_text", "tkout_time"),
    ("fab_value",),
    ("wafer_id",),
    ("lot_id", "lot_wf"),
    ("step_seq",),
    ("eqp_ch", "eqpch", "eqp_id", "eqpid"),
)


def normalize_lookup_value(value):
    if is_missing_value(value):
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            return f"{float(value):.12g}"
        except Exception:
            pass
    return str(value).strip()


def ppid_lookup_key(row):
    return tuple(normalize_lookup_value(get_first(row, group)) for group in PPID_LOOKUP_COLUMN_GROUPS)


def use_ppid_as_ppid_right(dataframe):
    columns = frame_columns(dataframe)
    return "ppid" in columns and "ppid_right" not in columns


def normalize_ppid_fields(rows, ppid_right_from_ppid=False, fallback_from_row_ppid=True):
    if not ppid_right_from_ppid:
        return rows

    for row in rows:
        if fallback_from_row_ppid and is_missing_value(row.get("ppid_right")) and not is_missing_value(row.get("ppid")):
            row["ppid_right"] = row.get("ppid")
        row["ppid"] = ""

    return rows


def ppid_lookup_from_all(dataframe, ppid_right_from_ppid=False):
    lookup = {}
    rows = add_time_fields(records(select_columns(dataframe)), "tkout_time")
    normalize_ppid_fields(rows, ppid_right_from_ppid)

    for row in rows:
        values = {column: row.get(column) for column in PPID_COLUMNS if not is_missing_value(row.get(column))}
        if not values:
            continue

        key = ppid_lookup_key(row)
        if key not in lookup:
            lookup[key] = values

    return lookup


def fill_ppid_fields(rows, ppid_lookup=None):
    if not ppid_lookup:
        return rows

    for row in rows:
        source = ppid_lookup.get(ppid_lookup_key(row))
        if not source:
            continue

        for column in PPID_COLUMNS:
            if is_missing_value(row.get(column)) and column in source:
                row[column] = source[column]

    return rows


def chart_records(dataframe, limit=900, anomaly_type=None, ppid_lookup=None, ppid_right_from_ppid=False, fallback_from_row_ppid=True):
    rows = add_time_fields(sample_records(select_columns(dataframe), limit), "tkout_time")
    fill_ppid_fields(rows, ppid_lookup)
    normalize_ppid_fields(rows, ppid_right_from_ppid, fallback_from_row_ppid)
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


def is_ng_decision(value):
    normalized = "".join(char for char in str(value or "").strip().upper() if char.isalnum())
    return normalized == "NG"


def final_decision_ng_numeric_values(dataframe, value_column="fab_value"):
    columns = frame_columns(dataframe)
    decision_column = "final_decision" if "final_decision" in columns else "FINAL_DECISION" if "FINAL_DECISION" in columns else ""
    if not decision_column:
        return []

    values = []
    for decision, value in zip(column_values(dataframe, decision_column), column_values(dataframe, value_column)):
        if not is_ng_decision(decision):
            continue
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
    q1 = percentile(sorted_values, 0.1)
    q3 = percentile(sorted_values, 0.9)
    iqr = q3 - q1
    if iqr <= 0:
        return values

    lower = q1 - iqr * 1.5
    upper = q3 + iqr * 1.5
    filtered = [value for value in values if lower <= value <= upper]
    return filtered or values


def outlier_display_domain(values, protected_values=None):
    filtered = outlier_filtered_values(values)
    if protected_values:
        filtered = filtered + protected_values
    if not filtered:
        return None
    return {"min": min(filtered) - 2, "max": max(filtered) * 1.2}


def time_domain_for_frames(dataframes, column):
    values = []
    for dataframe in dataframes:
        values.extend(value for value in (time_ms(value) for value in column_values(dataframe, column)) if value is not None)
    if not values:
        return None
    return {"min": min(values), "max": max(values)}


def time_domain(dataframe, column):
    return time_domain_for_frames((dataframe,), column)


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
    ppid_right_from_ppid = use_ppid_as_ppid_right(all_df)
    all_ppid_lookup = ppid_lookup_from_all(all_df, ppid_right_from_ppid)
    main_all_fab_values = numeric_column_values(all_df, "fab_value")
    center_ng_fab_values = final_decision_ng_numeric_values(fail_for_eqp)
    std_ng_fab_values = final_decision_ng_numeric_values(std_for_eqp)
    ng_fab_values = center_ng_fab_values + std_ng_fab_values
    chart_fab_values_center = main_all_fab_values + numeric_column_values(fail_for_eqp, "fab_value")
    chart_fab_values_std = main_all_fab_values + numeric_column_values(std_for_eqp, "fab_value")
    chart_fab_values = chart_fab_values_center + numeric_column_values(std_for_eqp, "fab_value")

    pm_events = pm_events_for_eqp(args.eqp_id)

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
                "x": time_domain_for_frames((all_df, fail_for_eqp, std_for_eqp), "tkout_time"),
                "yFull": numeric_domain(chart_fab_values),
                "yInitial": outlier_display_domain(main_all_fab_values, ng_fab_values),
                "center": {
                    "yFull": numeric_domain(chart_fab_values_center),
                    "yInitial": outlier_display_domain(main_all_fab_values, center_ng_fab_values),
                },
                "std": {
                    "yFull": numeric_domain(chart_fab_values_std),
                    "yInitial": outlier_display_domain(main_all_fab_values, std_ng_fab_values),
                },
            },
            "allPoints": chart_records(all_background, None, ppid_right_from_ppid=ppid_right_from_ppid),
            "failPoints": chart_records(fail_for_eqp, None, "center", all_ppid_lookup, ppid_right_from_ppid, False),
            "stdPoints": chart_records(std_for_eqp, None, "std", all_ppid_lookup, ppid_right_from_ppid, False),
            "pmEvents": pm_events,
        }
    )


def generic_chart_payload(resolved_paths, eqp_id, include_pm=True, filter_p3d_drawing=False):
    all_path = resolved_paths["allPath"]
    fail_path = resolved_paths["failPath"]
    std_path = resolved_paths["stdPath"]

    all_df = read_parquet(all_path)
    fail_df = read_parquet(fail_path)
    std_df = read_parquet(std_path) if std_path else fail_df.head(0)
    if filter_p3d_drawing:
        all_df = filter_frame_p3d_drawing(all_df)
        fail_df = filter_frame_p3d_drawing(fail_df)
        std_df = filter_frame_p3d_drawing(std_df)

    all_df = sort_frame(all_df, "tkout_time")
    fail_df = sort_frame(fail_df, "tkout_time")
    std_df = sort_frame(std_df, "tkout_time")

    all_background = exclude_frame_eqp(all_df, eqp_id)
    fail_for_eqp = filter_frame_eqp(fail_df, eqp_id)
    std_for_eqp = filter_frame_eqp(std_df, eqp_id)
    ppid_right_from_ppid = use_ppid_as_ppid_right(all_df)
    all_ppid_lookup = ppid_lookup_from_all(all_df, ppid_right_from_ppid)
    all_fab_values = numeric_column_values(all_df, "fab_value")
    center_ng_fab_values = final_decision_ng_numeric_values(fail_for_eqp)
    std_ng_fab_values = final_decision_ng_numeric_values(std_for_eqp)
    ng_fab_values = center_ng_fab_values + std_ng_fab_values
    chart_fab_values_center = all_fab_values + numeric_column_values(fail_for_eqp, "fab_value")
    chart_fab_values_std = all_fab_values + numeric_column_values(std_for_eqp, "fab_value")
    chart_fab_values = chart_fab_values_center + numeric_column_values(std_for_eqp, "fab_value")

    return {
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
            "pm": CONFIG["pmCodePath"] if include_pm else None,
        },
        "latestDate": resolved_paths["latestDate"],
        "itemDesc": item_desc_for_item_id(all_df, resolved_paths.get("resolved", {}).get("itemId", "")),
        "domains": {
            "x": time_domain_for_frames((all_df, fail_for_eqp, std_for_eqp), "tkout_time"),
            "yFull": numeric_domain(chart_fab_values),
            "yInitial": outlier_display_domain(all_fab_values, ng_fab_values),
            "center": {
                "yFull": numeric_domain(chart_fab_values_center),
                "yInitial": outlier_display_domain(all_fab_values, center_ng_fab_values),
            },
            "std": {
                "yFull": numeric_domain(chart_fab_values_std),
                "yInitial": outlier_display_domain(all_fab_values, std_ng_fab_values),
            },
        },
        "allPoints": chart_records(all_background, None, ppid_right_from_ppid=ppid_right_from_ppid),
        "failPoints": chart_records(fail_for_eqp, None, "center", all_ppid_lookup, ppid_right_from_ppid, False),
        "stdPoints": chart_records(std_for_eqp, None, "std", all_ppid_lookup, ppid_right_from_ppid, False),
        "pmEvents": pm_events_for_eqp(eqp_id) if include_pm else [],
    }


def command_chamber_chart(args):
    resolved_paths = resolve_chamber_chart_paths(args.line_code, args.device, args.main_step, args.chart_met_step)
    write_json(
        generic_chart_payload(
            resolved_paths,
            args.eqp_id,
            include_pm=True,
            filter_p3d_drawing=is_p3d_chamber_selection(getattr(args, "line_name", ""), args.line_code, args.device),
        )
    )


def pm_frame_for_eqp(eqp_id):
    if not os.path.isfile(CONFIG["pmCodePath"]) or not os.access(CONFIG["pmCodePath"], os.R_OK):
        return None

    pm_df = read_parquet(CONFIG["pmCodePath"])
    return filter_pm_frame_eqp(pm_df, eqp_id)


def pm_time_column(columns, prefer_date=False):
    if prefer_date and "date" in columns:
        return "date"
    if "inprg_dt" in columns:
        return "inprg_dt"
    if "date" in columns:
        return "date"
    return ""


def pm_events_for_eqp(eqp_id):
    pm_df = pm_frame_for_eqp(eqp_id)
    if pm_df is None:
        return []

    columns = frame_columns(pm_df)
    time_column = pm_time_column(columns)
    if not time_column or "work_type" not in columns:
        return []

    selected_columns = ["asset", time_column, "work_type", "description", "url"]
    rows = records(select_existing_frame_columns(sort_frame_desc(pm_df, time_column), selected_columns).head(80))
    for row in rows:
        if time_column != "inprg_dt":
            row["inprg_dt"] = row.get(time_column)
        if "asset" in row:
            row["asset"] = normalize_pm_equipment(row.get("asset"))
        for field in ("description", "url"):
            if field not in row or is_missing_value(row[field]):
                row[field] = ""
    return add_time_fields(rows, "inprg_dt")


def fcc_fail_rows_for_management(main_step, chart_met_step, eqp_id, diagnostics):
    fcc_fail_source = next(source for source in FCC_DATA_SOURCES if source["key"] == "fcc_fail")
    dataframe = read_parquet(fcc_fail_source["path"])
    rows = frame_records(dataframe)
    diagnostics.setdefault("inputRows", {})["fcc_fail"] = len(rows)
    diagnostics.setdefault("columns", {})["fcc_fail"] = frame_columns(dataframe)

    target_main_step = fcc_mapping_step_code(main_step)
    target_met_step = fcc_mapping_step_code(chart_met_step)
    target_item_id = fcc_item_id_from_met_seq(chart_met_step) if chart_met_step else ""
    matches = []

    for row in rows:
        eqp_ids = parse_eqp_ids(get_first(row, ("eqpid", "eqpch", "eqp_ch")))
        if str(eqp_id).strip() not in eqp_ids:
            continue

        row_main_step = str(get_first(row, ("main_seq", "main_step", "mainStep")) or "").strip()
        if target_main_step and fcc_mapping_step_code(row_main_step) != target_main_step:
            continue

        row_met_step = str(get_first(row, ("met_seq", "met_step", "metStep")) or "").strip()
        if target_met_step and fcc_mapping_step_code(row_met_step) != target_met_step:
            continue
        if target_item_id and fcc_item_id_from_met_seq(row_met_step) != target_item_id:
            continue

        matches.append(row)

    diagnostics.setdefault("usedRows", {})["fcc_fail"] = len(matches)
    return matches


def management_chart_met_step(met_step, met_item=""):
    met_item_text = normalize_step(met_item)
    if not met_item_text:
        met_item_text = strip_main_suffix(normalize_step(met_step)).split("_", 1)[0].strip()
    if not met_item_text:
        return ""
    if met_item_text.endswith(f"_{MANAGEMENT_RANDOM_PC_ITEM_ID}"):
        return met_item_text
    return f"{met_item_text}_{MANAGEMENT_RANDOM_PC_ITEM_ID}"


def management_met_specs_for_main_step(main_step, diagnostics):
    target_main_step = fcc_mapping_step_code(main_step)
    if not target_main_step:
        return []

    met_source = next(source for source in DATA_SOURCES if source["key"] == "met")
    line_code = CONFIG["selectLine"]
    source_key = "management_met"
    try:
        met_rows = read_met_rows(met_source["path"], device=None)
        diagnostics.setdefault("inputRows", {})[source_key] = len(met_rows)
        diagnostics.setdefault("columns", {})[source_key] = list(met_rows[0].keys()) if met_rows else []
        diagnostics.setdefault("resolvedPaths", {})["managementMetPath"] = met_source["path"]
    except Exception as exc:
        diagnostics.setdefault("warnings", []).append(f"관리 STEP MET 매핑 읽기 실패({met_source['path']}): {exc}")
        diagnostics.setdefault("inputRows", {})[source_key] = 0
        diagnostics.setdefault("columns", {})[source_key] = []
        return []

    specs = []
    seen = set()
    for row in met_rows:
        row_main_step_raw = str(row.get("main_step") or "").strip()
        if fcc_mapping_step_code(row_main_step_raw) != target_main_step:
            continue

        device = str(row.get("device") or CONFIG["device"]).strip()
        if not device:
            continue

        row_met_step_raw = str(row.get("met_step") or "").strip()
        row_met_item_raw = str(get_first(row, ("met_item", "metItem")) or "").strip()
        chart_met_step = management_chart_met_step(row_met_step_raw, row_met_item_raw)
        if not chart_met_step:
            continue
        key = (line_code, device, row_main_step_raw, chart_met_step)
        if key in seen:
            continue
        seen.add(key)
        specs.append(
            {
                "key": f"management::{line_code}::{device}::{row_main_step_raw}::{chart_met_step}",
                "dataKind": "chamber",
                "chartRoot": "management",
                "lineCode": line_code,
                "device": device,
                "mainStep": normalize_step(row_main_step_raw),
                "mainStepPath": row_main_step_raw,
                "stepSeq": normalize_step(row_main_step_raw),
                "metStep": chart_met_step,
                "metStepPath": chart_met_step,
                "stepDesc": row.get("step_desc") or "",
                "sdwt": row.get("sdwt") or "",
                "centerCount": 1,
                "stdCount": 0,
                "centerEqpIds": [],
                "stdEqpIds": [],
                "eqpIds": [],
            }
        )

    diagnostics.setdefault("usedRows", {})["management_met"] = len(specs)
    return specs


def management_specs_for_fcc_eqp(main_step, chart_met_step, eqp_id, diagnostics):
    fail_rows = fcc_fail_rows_for_management(main_step, chart_met_step, eqp_id, diagnostics)
    specs = []
    seen = set()
    for fail_row in fail_rows:
        fcc_main_step = str(get_first(fail_row, ("main_seq", "main_step", "mainStep")) or "").strip()
        fcc_met_step = str(get_first(fail_row, ("met_seq", "met_step", "metStep")) or chart_met_step or "").strip()
        for spec in management_met_specs_for_main_step(fcc_main_step, diagnostics):
            key = (spec["lineCode"], spec["device"], spec["mainStepPath"], spec["metStepPath"])
            if key in seen:
                continue
            seen.add(key)
            specs.append(
                {
                    **spec,
                    "fccMainStep": fcc_main_step,
                    "fccMetStep": fcc_met_step,
                    "fccEqpId": str(eqp_id).strip(),
                }
            )
    return specs


def management_all_chart_payload(resolved_paths, eqp_id):
    all_path = resolved_paths["allPath"]
    all_df = sort_frame(read_parquet(all_path), "tkout_time")
    ppid_right_from_ppid = use_ppid_as_ppid_right(all_df)
    highlight_df = filter_frame_eqp_ch(all_df, eqp_id)
    all_fab_values = numeric_column_values(all_df, "fab_value")
    highlight_fab_values = numeric_column_values(highlight_df, "fab_value")
    highlight_points = chart_records(highlight_df, None, "center", ppid_right_from_ppid=ppid_right_from_ppid)
    for point in highlight_points:
        point["management_highlight"] = True

    return {
        "ok": True,
        "diagnostics": {
            "version": LOADER_VERSION,
            "resolvedPaths": resolved_paths,
            "inputRows": {
                "all": frame_height(all_df),
                "highlight": frame_height(highlight_df),
            },
        },
        "paths": {
            "all": all_path,
            "fail": None,
            "std": None,
            "pm": None,
        },
        "latestDate": resolved_paths["latestDate"],
        "itemDesc": item_desc_for_item_id(all_df, resolved_paths.get("resolved", {}).get("itemId", "")),
        "domains": {
            "x": time_domain(all_df, "tkout_time"),
            "yFull": numeric_domain(all_fab_values),
            "yInitial": outlier_display_domain(all_fab_values, highlight_fab_values),
        },
        "allPoints": chart_records(all_df, None, ppid_right_from_ppid=ppid_right_from_ppid),
        "highlightPoints": highlight_points,
        "pmEvents": [],
    }


def fcc_chart_payload(
    resolved_paths,
    eqp_id,
    include_center=True,
    include_std=True,
    include_pm=True,
    require_std=False,
    include_current_eqp_in_all=False,
):
    all_path = resolved_paths["allPath"]
    fail_path = resolved_paths["failPath"]
    std_path = resolved_paths["stdPath"]

    all_raw_df = read_parquet(all_path)
    all_df = split_fcc_drawing_df(all_raw_df)
    if include_center:
        if not fail_path:
            raise FileNotFoundError(f"FCC fail parquet 파일을 찾지 못했습니다: {resolved_paths.get('dataDir', '')}")
        fail_raw_df = read_parquet(fail_path)
        fail_df = split_fcc_drawing_df(fail_raw_df)
    else:
        fail_raw_df = all_raw_df.head(0)
        fail_df = all_df.head(0)
    if include_std and std_path:
        std_raw_df = read_parquet(std_path)
        std_df = split_fcc_drawing_df(std_raw_df)
    elif include_std and require_std:
        raise FileNotFoundError(f"FCC fail_std parquet 파일을 찾지 못했습니다: {resolved_paths.get('dataDir', '')}")
    else:
        std_raw_df = all_raw_df.head(0)
        std_df = all_df.head(0)

    all_df = sort_frame(all_df, "tkout_time")
    fail_df = sort_frame(fail_df, "tkout_time")
    std_df = sort_frame(std_df, "tkout_time")
    all_background = exclude_frame_eqp(all_df, eqp_id)
    all_points_df = all_df if include_current_eqp_in_all else all_background
    fail_for_eqp = filter_frame_eqp(fail_df, eqp_id)
    std_for_eqp = filter_frame_eqp(std_df, eqp_id)
    ppid_right_from_ppid = use_ppid_as_ppid_right(all_df)
    all_ppid_lookup = ppid_lookup_from_all(all_df, ppid_right_from_ppid)
    all_fab_values = numeric_column_values(all_df, "fab_value")
    chart_fab_values_center = all_fab_values + numeric_column_values(fail_for_eqp, "fab_value")
    chart_fab_values_std = all_fab_values + numeric_column_values(std_for_eqp, "fab_value")
    chart_fab_values = chart_fab_values_center + numeric_column_values(std_for_eqp, "fab_value")

    return {
        "ok": True,
        "diagnostics": {
            "version": LOADER_VERSION,
            "resolvedPaths": resolved_paths,
            "inputRows": {
                "all": frame_height(all_df),
                "allBackground": frame_height(all_background),
                "allPoints": frame_height(all_points_df),
                "allRaw": frame_height(all_raw_df),
                "allP3dFilteredOut": max(0, frame_height(all_raw_df) - frame_height(all_df)),
                "fail": frame_height(fail_df),
                "failForEqp": frame_height(fail_for_eqp),
                "failRaw": frame_height(fail_raw_df),
                "failP3dFilteredOut": max(0, frame_height(fail_raw_df) - frame_height(fail_df)),
                "std": frame_height(std_df),
                "stdForEqp": frame_height(std_for_eqp),
                "stdRaw": frame_height(std_raw_df),
                "stdP3dFilteredOut": max(0, frame_height(std_raw_df) - frame_height(std_df)),
            },
        },
        "paths": {
            "all": all_path,
            "fail": fail_path if include_center else None,
            "std": std_path if include_std else None,
            "pm": CONFIG["pmCodePath"] if include_pm else None,
        },
        "latestDate": resolved_paths["latestDate"],
        "itemDesc": item_desc_for_item_id(all_df, resolved_paths.get("resolved", {}).get("itemId", "")),
        "domains": {
            "x": time_domain_for_frames((all_df, fail_for_eqp, std_for_eqp), "tkout_time"),
            "yFull": numeric_domain(chart_fab_values),
            "yInitial": numeric_domain(chart_fab_values),
            "center": {
                "yFull": numeric_domain(chart_fab_values_center),
                "yInitial": numeric_domain(chart_fab_values_center),
            },
            "std": {
                "yFull": numeric_domain(chart_fab_values_std),
                "yInitial": numeric_domain(chart_fab_values_std),
            },
        },
        "allPoints": chart_records(all_points_df, None, ppid_right_from_ppid=ppid_right_from_ppid),
        "failPoints": chart_records(fail_for_eqp, None, "center", all_ppid_lookup, ppid_right_from_ppid, False),
        "stdPoints": chart_records(std_for_eqp, None, "std", all_ppid_lookup, ppid_right_from_ppid, False),
        "pmEvents": pm_events_for_eqp(eqp_id) if include_pm else [],
    }


def filter_frame_eqp_ch_if_present(dataframe, eqp_ch):
    if any(column in frame_columns(dataframe) for column in ("eqp_ch", "eqpch")):
        return filter_frame_eqp_ch(dataframe, eqp_ch)
    return dataframe


def fcc_timefit_chart_payload(resolved_paths, eqp_ch, anomaly_count=0, include_pm=True):
    all_path = resolved_paths["allPath"]
    fail_path = resolved_paths["failPath"]

    all_df = sort_frame(timefit_fcc_drawing_df(read_parquet(all_path)), "tkout_time")
    fail_df = sort_frame(timefit_fcc_drawing_df(read_parquet(fail_path)), "tkout_time")
    fail_for_eqp = fail_df
    ppid_right_from_ppid = use_ppid_as_ppid_right(all_df)
    all_ppid_lookup = ppid_lookup_from_all(all_df, ppid_right_from_ppid)
    all_fab_values = numeric_column_values(all_df, "fab_value")
    chart_fab_values = all_fab_values + numeric_column_values(fail_for_eqp, "fab_value")

    return {
        "ok": True,
        "diagnostics": {
            "version": LOADER_VERSION,
            "resolvedPaths": resolved_paths,
            "inputRows": {
                "all": frame_height(all_df),
                "allBackground": frame_height(all_df),
                "fail": frame_height(fail_df),
                "failForEqp": frame_height(fail_for_eqp),
                "timefitListMatches": anomaly_count,
            },
        },
        "paths": {
            "all": all_path,
            "fail": fail_path,
            "std": None,
            "pm": CONFIG["pmCodePath"] if include_pm else None,
        },
        "pathLabels": {
            "all": "FCC 이상시점 all 배경 scatter",
            "fail": "FCC 이상시점 fail 중심치 이상 scatter",
        },
        "latestDate": resolved_paths["latestDate"],
        "itemDesc": item_desc_for_item_id(all_df, resolved_paths.get("resolved", {}).get("itemId", "")),
        "domains": {
            "x": time_domain_for_frames((all_df, fail_for_eqp), "tkout_time"),
            "yFull": numeric_domain(chart_fab_values),
            "yInitial": numeric_domain(chart_fab_values),
            "center": {
                "yFull": numeric_domain(chart_fab_values),
                "yInitial": numeric_domain(chart_fab_values),
            },
        },
        "allPoints": chart_records(all_df, None, ppid_right_from_ppid=ppid_right_from_ppid),
        "failPoints": chart_records(fail_for_eqp, None, "center", all_ppid_lookup, ppid_right_from_ppid, False),
        "stdPoints": [],
        "pmEvents": pm_events_for_eqp(eqp_ch) if include_pm else [],
        "timefitAnomalyCount": anomaly_count,
    }


def fcc_timefit_list_rows_for_eqp(main_step, chart_met_step, eqp_ch):
    timefit_source = next(source for source in FCC_DATA_SOURCES if source["key"] == "fcc_timefit_fail_list")
    try:
        rows = frame_records(read_parquet(timefit_source["path"]))
    except Exception:
        return []

    target_main_step = fcc_mapping_step_code(main_step)
    target_eqp_ch = str(eqp_ch or "").strip()
    matches = []
    for row in rows:
        row_main_step = fcc_mapping_step_code(fcc_timefit_main_seq(row))
        row_eqp_ids = fcc_timefit_eqp_ids(row)
        if target_main_step and row_main_step != target_main_step:
            continue
        if not fcc_timefit_matches_met_step(row, chart_met_step):
            continue
        if target_eqp_ch and target_eqp_ch not in row_eqp_ids:
            continue
        matches.append(row)
    return matches


def fcc_timefit_charts(main_step, chart_met_step, eqp_ch):
    matches = fcc_timefit_list_rows_for_eqp(main_step, chart_met_step, eqp_ch)
    if not matches:
        return []

    source_main_step_code = fcc_mapping_step_code(main_step)
    chart_met_step_text = strip_fcc_prefix(strip_percent_prefix(chart_met_step))
    matches_by_path = {}
    for row in matches:
        path_main_seq = fcc_timefit_main_seq(row)
        path_met_seq = fcc_timefit_met_seq(row)
        path_eqp_ids = fcc_timefit_eqp_ids(row)
        path_eqp_id = eqp_ch if eqp_ch in path_eqp_ids else (path_eqp_ids[0] if path_eqp_ids else "")
        if not path_main_seq or not path_met_seq or not path_eqp_id:
            continue
        path_key = (path_main_seq, path_met_seq, path_eqp_id)
        matches_by_path.setdefault(path_key, []).append(row)

    charts = []
    for (path_main_seq, path_met_seq, path_eqp_id), path_matches in sorted(matches_by_path.items()):
        path_main_step_code = fcc_mapping_step_code(path_main_seq)
        path_met_step_text = strip_fcc_prefix(strip_percent_prefix(path_met_seq))
        matched_fcc_step_seq = unique_nonempty(fcc_timefit_step_seq(row) for row in path_matches)
        spec = {
            "key": f"fcc_timefit::{source_main_step_code}::{path_main_step_code}::{path_met_step_text}::{path_eqp_id}",
            "dataKind": "fcc",
            "chartRoot": "timefit",
            "sourcePriority": 0,
            "mainStep": path_main_step_code,
            "mainStepPath": path_main_seq,
            "stepSeq": path_main_step_code,
            "metStep": path_met_step_text,
            "metStepPath": path_met_seq,
            "stepDesc": "",
            "sdwt": "",
            "centerCount": len(path_matches),
            "stdCount": 0,
            "centerEqpIds": [path_eqp_id],
            "stdEqpIds": [],
            "eqpIds": [path_eqp_id],
            "timefitCount": len(path_matches),
            "timefitEqpIds": [path_eqp_id],
            "fccSourceMainStep": source_main_step_code,
            "fccStepSeq": matched_fcc_step_seq[0] if matched_fcc_step_seq else "",
        }

        try:
            resolved_paths = resolve_fcc_timefit_chart_paths(path_main_seq, path_met_seq, path_eqp_id)
            payload = fcc_timefit_chart_payload(resolved_paths, path_eqp_id, anomaly_count=len(path_matches), include_pm=True)
            payload["row"] = spec
            charts.append(payload)
        except Exception as exc:
            charts.append(
                {
                    "ok": False,
                    "row": spec,
                    "error": str(exc),
                    "paths": {},
                    "pathLabels": {
                        "all": "FCC 이상시점 all 배경 scatter",
                        "fail": "FCC 이상시점 fail 중심치 이상 scatter",
                    },
                    "diagnostics": {
                        "version": LOADER_VERSION,
                        "inputRows": {"timefitListMatches": len(path_matches)},
                    },
                }
            )

    return charts


def fcc_extra_chart_specs_for_eqp(eqp_id, source_key="fcc_extra_fail", anomaly_type="center"):
    extra_met_source = next(source for source in FCC_DATA_SOURCES if source["key"] == "fcc_extra_met")
    extra_source = next(source for source in FCC_DATA_SOURCES if source["key"] == source_key)
    fcc_fail_source = next(source for source in FCC_DATA_SOURCES if source["key"] == "fcc_fail")
    is_std = anomaly_type == "std"

    try:
        fcc_fail_rows = frame_records(read_parquet(fcc_fail_source["path"]))
        if eqp_id not in collect_eqp_ids(fcc_fail_rows, ("eqpid", "eqpch", "eqp_ch")):
            return []
        extra_rows = frame_records(read_parquet(extra_source["path"]))
        extra_met_rows = read_met_rows(extra_met_source["path"], device=None)
    except Exception:
        return []

    extra_met_by_key, extra_met_by_main_step = fcc_met_mapping_index(extra_met_rows)
    specs = []
    seen = set()
    for row in extra_rows:
        if eqp_id not in parse_eqp_ids(get_first(row, ("eqpid", "eqpch", "eqp_ch"))):
            continue

        main_step_raw = str(get_first(row, ("main_seq", "main_step", "mainStep")) or "").strip()
        met_seq_raw = str(get_first(row, ("met_seq", "met_step", "metStep")) or "").strip()
        main_step = fcc_mapping_step_code(main_step_raw)
        fail_met_step = fcc_mapping_step_code(met_seq_raw)
        item_id = fcc_item_id_from_met_seq(met_seq_raw)
        if not main_step or not fail_met_step or not item_id:
            continue

        mapped_entry = extra_met_by_key.get((main_step, fail_met_step))
        candidates = extra_met_by_main_step.get(main_step, [])
        if mapped_entry is None and len(candidates) == 1:
            mapped_entry = candidates[0]
        if mapped_entry is None:
            continue

        met_seq = f"{mapped_entry['metStep']}_{item_id}"
        key = (mapped_entry["mainStepPath"], met_seq)
        if key in seen:
            continue
        seen.add(key)

        specs.append(
            {
                "key": f"fcc_extra_{anomaly_type}::{mapped_entry['mainStep']}::{met_seq}",
                "dataKind": "fcc",
                "chartRoot": "root",
                "sourcePriority": 0,
                "mainStep": mapped_entry["mainStep"],
                "mainStepPath": mapped_entry["mainStepPath"],
                "stepSeq": mapped_entry["mainStep"],
                "metStep": met_seq,
                "metStepPath": met_seq,
                "stepDesc": mapped_entry["stepDesc"],
                "sdwt": mapped_entry["sdwt"],
                "centerCount": 0 if is_std else 1,
                "stdCount": 1 if is_std else 0,
                "centerEqpIds": [] if is_std else [eqp_id],
                "stdEqpIds": [eqp_id] if is_std else [],
                "eqpIds": [eqp_id],
            }
        )
    return specs


def fcc_extra_center_charts(eqp_id):
    charts = []
    for spec in fcc_extra_chart_specs_for_eqp(eqp_id, source_key="fcc_extra_fail", anomaly_type="center"):
        try:
            resolved_paths = resolve_fcc_chart_paths(spec["mainStepPath"], spec["metStepPath"], "root", resolve_std=False)
            payload = fcc_chart_payload(
                resolved_paths,
                eqp_id,
                include_center=True,
                include_std=False,
                include_pm=True,
                include_current_eqp_in_all=True,
            )
            payload["row"] = spec
            charts.append(payload)
        except Exception as exc:
            charts.append(
                {
                    "ok": False,
                    "row": spec,
                    "error": str(exc),
                    "paths": {},
                    "diagnostics": {"version": LOADER_VERSION},
                }
            )
    return charts


def fcc_extra_std_charts(eqp_id):
    charts = []
    for spec in fcc_extra_chart_specs_for_eqp(eqp_id, source_key="fcc_extra_std", anomaly_type="std"):
        try:
            resolved_paths = resolve_fcc_chart_paths(
                spec["mainStepPath"],
                spec["metStepPath"],
                "root",
                require_fail=False,
                resolve_std=True,
                require_std=True,
            )
            payload = fcc_chart_payload(
                resolved_paths,
                eqp_id,
                include_center=False,
                include_std=True,
                include_pm=True,
                require_std=True,
                include_current_eqp_in_all=True,
            )
            payload["row"] = spec
            charts.append(payload)
        except Exception as exc:
            charts.append(
                {
                    "ok": False,
                    "row": spec,
                    "error": str(exc),
                    "paths": {},
                    "diagnostics": {"version": LOADER_VERSION},
                }
            )
    return charts


def command_fcc_chart(args):
    resolved_paths = resolve_fcc_chart_paths(args.main_step, args.chart_met_step, args.chart_root, resolve_std=False)
    payload = fcc_chart_payload(resolved_paths, args.eqp_id, include_center=True, include_std=False, include_pm=True)
    should_load_extra_charts = args.chart_root == "step" and not getattr(args, "suppress_extra_charts", False)
    payload["extraCenterCharts"] = fcc_extra_center_charts(args.eqp_id) if should_load_extra_charts else []
    payload["extraStdCharts"] = fcc_extra_std_charts(args.eqp_id) if should_load_extra_charts else []
    payload["timefitCharts"] = fcc_timefit_charts(args.main_step, args.chart_met_step, args.eqp_id) if should_load_extra_charts else []
    write_json(payload)


def command_fcc_management_chart(args):
    diagnostics = {
        "version": LOADER_VERSION,
        "requested": {
            "mainStep": args.main_step,
            "chartMetStep": args.chart_met_step,
            "eqpId": args.eqp_id,
        },
        "inputRows": {},
        "columns": {},
        "usedRows": {},
        "warnings": [],
    }
    specs = management_specs_for_fcc_eqp(args.main_step, args.chart_met_step, args.eqp_id, diagnostics)
    charts = []

    for spec in specs:
        try:
            resolved_paths = resolve_chamber_all_chart_paths(
                spec["lineCode"],
                spec["device"],
                spec["mainStepPath"],
                spec["metStepPath"],
            )
            payload = management_all_chart_payload(resolved_paths, args.eqp_id)
            payload["row"] = spec
            charts.append(payload)
        except Exception as exc:
            charts.append(
                {
                    "ok": False,
                    "row": spec,
                    "error": str(exc),
                    "paths": {},
                    "diagnostics": {"version": LOADER_VERSION},
                }
            )

    write_json(
        {
            "ok": True,
            "charts": charts,
            "diagnostics": {
                **diagnostics,
                "outputRows": len(charts),
            },
        }
    )


def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("summary")
    subparsers.add_parser("fcc-summary")
    subparsers.add_parser("chamber-lines")
    click_history_parser = subparsers.add_parser("click-history")
    click_history_parser.add_argument("--line-name", required=True)
    click_history_parser.add_argument("--select-step", required=True)
    chamber_summary_parser = subparsers.add_parser("chamber-summary")
    chamber_summary_parser.add_argument("--line-code", required=True)
    chamber_summary_parser.add_argument("--device", required=True)
    chamber_summary_parser.add_argument("--line-name", default="")
    chart_parser = subparsers.add_parser("chart")
    chart_parser.add_argument("--main-step", required=True)
    chart_parser.add_argument("--chart-met-step", required=True)
    chart_parser.add_argument("--eqp-id", required=True)
    chamber_chart_parser = subparsers.add_parser("chamber-chart")
    chamber_chart_parser.add_argument("--line-code", required=True)
    chamber_chart_parser.add_argument("--device", required=True)
    chamber_chart_parser.add_argument("--main-step", required=True)
    chamber_chart_parser.add_argument("--chart-met-step", required=True)
    chamber_chart_parser.add_argument("--eqp-id", required=True)
    chamber_chart_parser.add_argument("--line-name", default="")
    fcc_chart_parser = subparsers.add_parser("fcc-chart")
    fcc_chart_parser.add_argument("--main-step", required=True)
    fcc_chart_parser.add_argument("--chart-met-step", required=True)
    fcc_chart_parser.add_argument("--eqp-id", required=True)
    fcc_chart_parser.add_argument("--chart-root", choices=("step", "root"), default="step")
    fcc_chart_parser.add_argument("--suppress-extra-charts", action="store_true")
    fcc_management_chart_parser = subparsers.add_parser("fcc-management-chart")
    fcc_management_chart_parser.add_argument("--main-step", required=True)
    fcc_management_chart_parser.add_argument("--chart-met-step", required=True)
    fcc_management_chart_parser.add_argument("--eqp-id", required=True)
    args = parser.parse_args()

    try:
        if args.command == "summary":
            command_summary(args)
        elif args.command == "fcc-summary":
            command_fcc_summary(args)
        elif args.command == "chamber-lines":
            command_chamber_lines(args)
        elif args.command == "click-history":
            command_click_history(args)
        elif args.command == "chamber-summary":
            command_chamber_summary(args)
        elif args.command == "chart":
            command_chart(args)
        elif args.command == "chamber-chart":
            command_chamber_chart(args)
        elif args.command == "fcc-chart":
            command_fcc_chart(args)
        elif args.command == "fcc-management-chart":
            command_fcc_management_chart(args)
    except Exception as exc:
        if args.command.startswith("fcc"):
            sources = source_status(FCC_DATA_SOURCES)
        elif args.command == "click-history":
            sources = []
        elif args.command in ("chamber-summary", "chamber-chart") and getattr(args, "line_code", None) and getattr(args, "device", None):
            sources = source_status(chamber_data_sources(args.line_code, args.device))
        elif args.command.startswith("chamber"):
            sources = source_status(CHAMBER_DATA_SOURCES)
        else:
            sources = source_status()
        write_json(
            {
                "ok": False,
                "error": str(exc),
                "config": CONFIG,
                "diagnostics": {"version": LOADER_VERSION, "resolvedPaths": resolved_paths_for_command(args.command)},
                "sources": sources,
            }
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

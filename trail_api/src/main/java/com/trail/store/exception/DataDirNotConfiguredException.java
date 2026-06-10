package com.trail.store.exception;

/** 数据目录未配置。所有 /api/*（health + data-dir 探测端点除外）→ 503 {code: "NEEDS_DATA_DIR"} */
public class DataDirNotConfiguredException extends RuntimeException {
    public DataDirNotConfiguredException() {
        super("请先指定数据目录");
    }
    public DataDirNotConfiguredException(String msg) {
        super(msg);
    }
}

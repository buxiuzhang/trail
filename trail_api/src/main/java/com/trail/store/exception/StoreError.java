package com.trail.store.exception;

/** 业务校验失败（如标题为空、状态非法、转移不合法、已作废任务写日志拒绝等）。→ 400 */
public class StoreError extends RuntimeException {
    public StoreError(String msg) { super(msg); }
}

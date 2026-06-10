package com.trail.store.exception;

/** 任务/日志不存在。→ 404 */
public class NotFoundException extends RuntimeException {
    public NotFoundException(String msg) { super(msg); }
}

package com.trail.store.exception;

/** 标题重复 / 唯一键冲突。→ 409 */
public class DuplicateException extends RuntimeException {
    public DuplicateException(String msg) { super(msg); }
}

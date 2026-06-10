package com.trail.store.exception;

/** 状态机非法转移。→ 400 */
public class InvalidTransitionException extends RuntimeException {
    public InvalidTransitionException(String msg) { super(msg); }
}

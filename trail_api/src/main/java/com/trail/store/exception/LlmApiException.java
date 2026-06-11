package com.trail.store.exception;

/** LLM API 调用失败（网络、余额、模型错误等）→ 502 */
public class LlmApiException extends RuntimeException {
    public LlmApiException(String message) {
        super("LLM 调用失败：" + message);
    }

    public LlmApiException(String message, Throwable cause) {
        super("LLM 调用失败：" + message, cause);
    }
}

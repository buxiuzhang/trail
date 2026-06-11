package com.trail.store.exception;

/** LLM 未配置（缺 api_key）→ 503 */
public class LlmNotConfiguredException extends RuntimeException {
    public LlmNotConfiguredException() {
        super("LLM 未配置，请先在设置页面配置 API Key");
    }
}

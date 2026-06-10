package com.trail.web.dto;

import com.trail.store.AttachmentStore;

/** 附件响应（上传成功 / 详情查询都返这形态）。 */
public record AttachmentResponse(
        Long id,
        String url,
        String mime,
        Long byteSize,
        String originalName
) {
    public static AttachmentResponse from(AttachmentStore.Saved s) {
        return new AttachmentResponse(s.id(), s.url(), s.mime(), s.byteSize(), s.originalName());
    }
}

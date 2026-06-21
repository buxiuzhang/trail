package com.trail.web.dto;

import com.trail.store.AttachmentStore;

/** 附件列表项响应（文件管理页使用）。 */
public record AttachmentListItemResponse(
        long id,
        String url,
        String mime,
        long byteSize,
        String originalName,
        int displaySize,
        String createdAt,
        int refCount,
        int activeRefCount
) {
    public static AttachmentListItemResponse from(AttachmentStore.ListItem item) {
        return new AttachmentListItemResponse(
                item.id(), item.url(), item.mime(), item.byteSize(),
                item.originalName(), item.displaySize(), item.createdAt(),
                item.refCount(), item.activeRefCount());
    }
}

package com.trail.web.controller;

import com.trail.store.AttachmentStore;
import com.trail.web.dto.AttachmentResponse;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** 附件上传 / 下载（M10：描述位截图粘贴）。 */
@RestController
@RequestMapping("/api/attachments")
public class AttachmentController {

    private final AttachmentStore store;

    public AttachmentController(AttachmentStore store) {
        this.store = store;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public AttachmentResponse upload(@RequestParam("file") MultipartFile file) {
        return AttachmentResponse.from(store.save(file));
    }

    @GetMapping("/{id}")
    public ResponseEntity<FileSystemResource> serve(@PathVariable long id) {
        AttachmentStore.Loaded f = store.load(id);
        MediaType ct;
        try {
            ct = MediaType.parseMediaType(f.mime());
        } catch (Exception e) {
            ct = MediaType.APPLICATION_OCTET_STREAM;
        }
        return ResponseEntity.ok()
                .contentType(ct)
                .body(new FileSystemResource(f.absolutePath()));
    }
}

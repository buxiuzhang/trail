package com.trail.web.controller;

import com.trail.store.AttachmentStore;
import com.trail.store.exception.NotFoundException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * AttachmentController 集成测试（MockMvc + MockBean store）。
 * 覆盖上传 / 下载 / 去重 / 异常转译。
 */
@WebMvcTest(AttachmentController.class)
class AttachmentControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private AttachmentStore store;

    @Nested
    @DisplayName("POST /api/attachments — 上传")
    class Upload {

        @Test
        @DisplayName("正常上传 PNG → 200 + 全字段")
        void uploadPngOk() throws Exception {
            byte[] content = { (byte) 0x89, 'P', 'N', 'G' };
            var saved = new AttachmentStore.Saved(1L, "/api/attachments/1",
                    "image/png", (long) content.length, "screenshot.png");
            when(store.save(any())).thenReturn(saved);

            var file = new MockMultipartFile("file", "screenshot.png",
                    "image/png", content);

            mvc.perform(multipart("/api/attachments").file(file))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value(1))
                    .andExpect(jsonPath("$.url").value("/api/attachments/1"))
                    .andExpect(jsonPath("$.mime").value("image/png"))
                    .andExpect(jsonPath("$.byteSize").value(4))
                    .andExpect(jsonPath("$.originalName").value("screenshot.png"));
        }

        @Test
        @DisplayName("不支持 mime → 415")
        void rejectNonImageMime() throws Exception {
            when(store.save(any())).thenThrow(
                    new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                            "仅支持 png / jpeg / gif / webp，当前：text/plain"));

            var file = new MockMultipartFile("file", "doc.txt",
                    "text/plain", "hello".getBytes());

            mvc.perform(multipart("/api/attachments").file(file))
                    .andExpect(status().isUnsupportedMediaType());
        }

        @Test
        @DisplayName("SHA-256 去重 → 返旧 id")
        void dedupBySha256() throws Exception {
            byte[] content = { 1, 2, 3 };
            var saved = new AttachmentStore.Saved(7L, "/api/attachments/7",
                    "image/png", 3L, "dupe.png");
            when(store.save(any())).thenReturn(saved);

            var file = new MockMultipartFile("file", "dupe.png",
                    "image/png", content);

            mvc.perform(multipart("/api/attachments").file(file))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value(7));
        }
    }

    @Nested
    @DisplayName("GET /api/attachments/{id} — 下载")
    class Serve {

        @Test
        @DisplayName("存在的记录 → 200 + 流式返图")
        void serveExisting() throws Exception {
            Path tmp = Files.createTempFile("att-test", ".png");
            Files.writeString(tmp, "fake-png-body");
            try {
                var loaded = new AttachmentStore.Loaded(tmp, "image/png");
                when(store.load(1L)).thenReturn(loaded);

                mvc.perform(get("/api/attachments/1"))
                        .andExpect(status().isOk())
                        .andExpect(content().contentType("image/png"))
                        .andExpect(content().string("fake-png-body"));
            } finally {
                Files.deleteIfExists(tmp);
            }
        }

        @Test
        @DisplayName("不存在 → 404 + detail")
        void serveNotFound() throws Exception {
            when(store.load(999999L)).thenThrow(
                    new NotFoundException("附件不存在：999999"));

            mvc.perform(get("/api/attachments/999999"))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.detail").value("附件不存在：999999"));
        }
    }
}

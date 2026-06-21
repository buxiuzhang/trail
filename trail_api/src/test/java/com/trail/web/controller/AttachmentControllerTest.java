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
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * AttachmentController 集成测试（MockMvc + MockBean store）。
 * id 为自增整数；M11 涵盖 displaySize 更新、引用反查、物理删除。
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
        @DisplayName("正常上传 PNG → 200 + 全字段（含 displaySize=100）")
        void uploadPngOk() throws Exception {
            byte[] content = { (byte) 0x89, 'P', 'N', 'G' };
            var saved = new AttachmentStore.Saved(1L, "/api/attachments/1",
                    "image/png", (long) content.length, "screenshot.png", 100);
            when(store.save(any())).thenReturn(saved);

            var file = new MockMultipartFile("file", "screenshot.png",
                    "image/png", content);

            mvc.perform(multipart("/api/attachments").file(file))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value(1))
                    .andExpect(jsonPath("$.url").value("/api/attachments/1"))
                    .andExpect(jsonPath("$.mime").value("image/png"))
                    .andExpect(jsonPath("$.byteSize").value(4))
                    .andExpect(jsonPath("$.originalName").value("screenshot.png"))
                    .andExpect(jsonPath("$.displaySize").value(100));
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
        @DisplayName("SHA-256 去重 → 返旧 id（displaySize 一致）")
        void dedupBySha256() throws Exception {
            byte[] content = { 1, 2, 3 };
            var saved = new AttachmentStore.Saved(7L, "/api/attachments/7",
                    "image/png", 3L, "dupe.png", 100);
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

    @Nested
    @DisplayName("PUT /api/attachments/{id} — 更新 displaySize")
    class UpdateSize {

        @Test
        @DisplayName("正常更新 50 → 200 + displaySize 字段")
        void updateSizeOk() throws Exception {
            var row = new AttachmentStore.Row(1L, "2026/06/abc.png", "image/png",
                    100L, "x.png", 50);
            when(store.updateSize(eq(1L), eq(50))).thenReturn(row);

            mvc.perform(put("/api/attachments/1")
                            .contentType("application/json")
                            .content("{\"displaySize\":50}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value(1))
                    .andExpect(jsonPath("$.displaySize").value(50));
        }

        @Test
        @DisplayName("displaySize=0 越界 → 400")
        void updateSizeZero() throws Exception {
            mvc.perform(put("/api/attachments/1")
                            .contentType("application/json")
                            .content("{\"displaySize\":0}"))
                    .andExpect(status().isBadRequest());
        }

        @Test
        @DisplayName("displaySize=101 越界 → 400")
        void updateSizeTooBig() throws Exception {
            mvc.perform(put("/api/attachments/1")
                            .contentType("application/json")
                            .content("{\"displaySize\":101}"))
                    .andExpect(status().isBadRequest());
        }

        @Test
        @DisplayName("缺 displaySize 字段 → 400")
        void updateSizeMissing() throws Exception {
            mvc.perform(put("/api/attachments/1")
                            .contentType("application/json")
                            .content("{}"))
                    .andExpect(status().isBadRequest());
        }
    }

    @Nested
    @DisplayName("GET /api/attachments/{id}/references — 反查引用")
    class FindReferences {

        @Test
        @DisplayName("0 引用 → []")
        void referencesEmpty() throws Exception {
            when(store.get(1L)).thenReturn(new AttachmentStore.Row(1L, "x.png", "image/png",
                    10L, "x.png", 100));
            when(store.findReferences(1L)).thenReturn(List.of());

            mvc.perform(get("/api/attachments/1/references"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$").isArray())
                    .andExpect(jsonPath("$.length()").value(0));
        }

        @Test
        @DisplayName("多处引用 → 数组包含 sourceType/sourceId/column/taskId/snippet")
        void referencesMultiple() throws Exception {
            when(store.get(1L)).thenReturn(new AttachmentStore.Row(1L, "x.png", "image/png",
                    10L, "x.png", 100));
            when(store.findReferences(1L)).thenReturn(List.of(
                    new AttachmentStore.Reference("task", 10L, "description",
                            10L, "数据湖巡检", null,
                            "…前文… ![x](/api/attachments/1) …后文…", false),
                    new AttachmentStore.Reference("log", 30L, "content",
                            10L, null, "2026-06-10",
                            "…日志里也引用了… ![x](/api/attachments/1) …", false)
            ));

            mvc.perform(get("/api/attachments/1/references"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.length()").value(2))
                    .andExpect(jsonPath("$[0].sourceType").value("task"))
                    .andExpect(jsonPath("$[0].column").value("description"))
                    .andExpect(jsonPath("$[0].title").value("数据湖巡检"))
                    .andExpect(jsonPath("$[1].sourceType").value("log"))
                    .andExpect(jsonPath("$[1].logDate").value("2026-06-10"));
        }

        @Test
        @DisplayName("id 不存在 → 404")
        void referencesNotFound() throws Exception {
            when(store.get(999L)).thenThrow(new NotFoundException("附件不存在：999"));

            mvc.perform(get("/api/attachments/999/references"))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.detail").value("附件不存在：999"));
        }
    }

    @Nested
    @DisplayName("DELETE /api/attachments/{id} — 删除")
    class Delete {

        @Test
        @DisplayName("0 引用 → 204")
        void deleteUnused() throws Exception {
            when(store.findReferences(1L)).thenReturn(List.of());
            org.mockito.Mockito.doNothing().when(store).delete(1L);

            mvc.perform(delete("/api/attachments/1"))
                    .andExpect(status().isNoContent());
        }

        @Test
        @DisplayName(">0 引用 → 409 + ATTACHMENT_IN_USE")
        void deleteInUse() throws Exception {
            when(store.findReferences(1L)).thenReturn(List.of(
                    new AttachmentStore.Reference("task", 10L, "description",
                            10L, "数据湖巡检", null, "…[/api/attachments/1)…", false)
            ));

            mvc.perform(delete("/api/attachments/1"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.error").value("ATTACHMENT_IN_USE"))
                    .andExpect(jsonPath("$.refCount").value(1))
                    .andExpect(jsonPath("$.references[0].sourceType").value("task"))
                    .andExpect(jsonPath("$.references[0].title").value("数据湖巡检"));
        }
    }
}

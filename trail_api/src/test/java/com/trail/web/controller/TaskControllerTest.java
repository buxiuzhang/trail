package com.trail.web.controller;

import com.trail.store.ContactStore;
import com.trail.store.TaskStore;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * TaskController.list 分页 + 预聚合 + 批量 contacts 测试。
 * 关键点：验证 5 聚合字段透传、limit/offset/月/标签筛选透传、contacts 走 IN 批量（不循环）。
 */
@WebMvcTest(TaskController.class)
class TaskControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private TaskStore taskStore;

    @MockBean
    private ContactStore contactStore;

    /** 构造一个 mock 任务行（含 5 聚合字段）。 */
    private Map<String, Object> row(long id, String title, String status, int todoA, int todoC, int todoX, int logN, int logMain) {
        Map<String, Object> r = new HashMap<>();
        r.put("id", id);
        r.put("title", title);
        r.put("alias", null);
        r.put("description", null);
        r.put("start_date", LocalDate.of(2026, 6, 1));
        r.put("processing_date", LocalDate.of(2026, 6, 5));
        r.put("end_date", null);
        r.put("status", status);
        r.put("nature", "长期");
        r.put("summary", null);
        r.put("maintenance_summary", null);
        r.put("tags", "[\"电化学储能\"]");
        r.put("original_title", null);
        r.put("source", null);
        r.put("pinned_at", null);
        r.put("created_at", null);
        r.put("updated_at", null);
        r.put("last_log_date", LocalDate.of(2026, 6, 12));
        r.put("todo_active_count", todoA);
        r.put("todo_completed_count", todoC);
        r.put("todo_abandoned_count", todoX);
        r.put("log_count", logN);
        r.put("log_main_count", logMain);
        return r;
    }

    @Nested
    @DisplayName("GET /api/tasks — 分页 + 预聚合")
    class ListPagedAndAggregated {

        @Test
        @DisplayName("不传 limit → 全量（向后兼容），total == items.length")
        void defaultReturnsAll() throws Exception {
            List<Map<String, Object>> rows = List.of(
                    row(1L, "数据湖巡检", "进行中", 3, 1, 0, 5, 4),
                    row(2L, "时序库优化", "已完成", 0, 2, 1, 8, 6)
            );
            when(taskStore.listTasksPaged(any(), any(), any(), any(), any(), any(), any()))
                    .thenReturn(rows);
            when(taskStore.countTasks(any(), any(), any(), any(), any())).thenReturn(2L);
            when(contactStore.listContactsBulk(anyList())).thenReturn(Map.of());

            mvc.perform(get("/api/tasks"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.items.length()").value(2))
                    .andExpect(jsonPath("$.total").value(2))
                    // 5 聚合字段都在 JSON 里
                    .andExpect(jsonPath("$.items[0].id").value(1))
                    .andExpect(jsonPath("$.items[0].title").value("数据湖巡检"))
                    .andExpect(jsonPath("$.items[0].todoActiveCount").value(3))
                    .andExpect(jsonPath("$.items[0].todoCompletedCount").value(1))
                    .andExpect(jsonPath("$.items[0].todoAbandonedCount").value(0))
                    .andExpect(jsonPath("$.items[0].logCount").value(5))
                    .andExpect(jsonPath("$.items[0].logMainCount").value(4))
                    .andExpect(jsonPath("$.items[1].logMainCount").value(6));
        }

        @Test
        @DisplayName("limit=5 offset=0 → 透传到 store")
        void limitOffsetPassed() throws Exception {
            when(taskStore.listTasksPaged(any(), any(), any(), any(), any(), eq(5), eq(0)))
                    .thenReturn(List.of());
            when(taskStore.countTasks(any(), any(), any(), any(), any())).thenReturn(12L);
            when(contactStore.listContactsBulk(anyList())).thenReturn(Map.of());

            mvc.perform(get("/api/tasks").param("limit", "5").param("offset", "0"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.items.length()").value(0))
                    .andExpect(jsonPath("$.total").value(12));

            verify(taskStore).listTasksPaged(any(), any(), any(), any(), any(), eq(5), eq(0));
        }

        @Test
        @DisplayName("limit 不传 offset 传 → limit 默认 Integer.MAX_VALUE")
        void offsetOnlyDefaultsLimit() throws Exception {
            when(taskStore.listTasksPaged(any(), any(), any(), any(), any(), eq(Integer.MAX_VALUE), eq(5)))
                    .thenReturn(List.of());
            when(taskStore.countTasks(any(), any(), any(), any(), any())).thenReturn(0L);
            when(contactStore.listContactsBulk(anyList())).thenReturn(Map.of());

            mvc.perform(get("/api/tasks").param("offset", "5"))
                    .andExpect(status().isOk());

            verify(taskStore).listTasksPaged(any(), any(), any(), any(), any(),
                    eq(Integer.MAX_VALUE), eq(5));
        }

        @Test
        @DisplayName("status / nature / month / tag 4 个筛选参数都透传")
        void filtersPropagate() throws Exception {
            when(taskStore.listTasksPaged(
                    eq("进行中"), eq("长期"), any(), eq("2026-06"), eq("电化学储能"),
                    any(), any())).thenReturn(List.of());
            when(taskStore.countTasks("进行中", "长期", null, "2026-06", "电化学储能"))
                    .thenReturn(3L);
            when(contactStore.listContactsBulk(anyList())).thenReturn(Map.of());

            mvc.perform(get("/api/tasks")
                    .param("status", "进行中")
                    .param("nature", "长期")
                    .param("month", "2026-06")
                    .param("tag", "电化学储能"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.total").value(3));

            verify(taskStore).listTasksPaged(
                    eq("进行中"), eq("长期"), any(), eq("2026-06"), eq("电化学储能"),
                    any(), any());
            verify(taskStore).countTasks("进行中", "长期", null, "2026-06", "电化学储能");
        }

        @Test
        @DisplayName("5 聚合字段缺失时按 0 返回（不抛错）")
        void missingAggregatesDefaultZero() throws Exception {
            Map<String, Object> sparse = row(99L, "sparse", "进行中", 0, 0, 0, 0, 0);
            // 模拟聚合字段恰好为 0（LEFT JOIN 不命中时 SUM 返 NULL，COALESCE 成 0）
            when(taskStore.listTasksPaged(any(), any(), any(), any(), any(), any(), any()))
                    .thenReturn(List.of(sparse));
            when(taskStore.countTasks(any(), any(), any(), any(), any())).thenReturn(1L);
            when(contactStore.listContactsBulk(anyList())).thenReturn(Map.of());

            mvc.perform(get("/api/tasks"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.items[0].todoActiveCount").value(0))
                    .andExpect(jsonPath("$.items[0].logCount").value(0));
        }
    }

    @Nested
    @DisplayName("GET /api/tasks — 批量 contacts (N+1 → 1 次 IN)")
    class BulkContacts {

        @Test
        @DisplayName("多 task → 一次 listContactsBulk(ids)，不是循环 listContacts")
        void bulkInsteadOfLoop() throws Exception {
            List<Map<String, Object>> rows = List.of(
                    row(1L, "a", "进行中", 0, 0, 0, 0, 0),
                    row(2L, "b", "进行中", 0, 0, 0, 0, 0),
                    row(3L, "c", "进行中", 0, 0, 0, 0, 0)
            );
            when(taskStore.listTasksPaged(any(), any(), any(), any(), any(), any(), any()))
                    .thenReturn(rows);
            when(taskStore.countTasks(any(), any(), any(), any(), any())).thenReturn(3L);

            // Map.of 不允许 null value，改用 HashMap 显式构造
            Map<String, Object> c1 = new HashMap<>();
            c1.put("id", 10);
            c1.put("task_id", 1);
            c1.put("name", "项目组");
            c1.put("kind", "group");
            c1.put("channel", "dingtalk");
            c1.put("target", null);
            c1.put("note", null);
            c1.put("created_at", null);
            Map<String, Object> c2 = new HashMap<>();
            c2.put("id", 11);
            c2.put("task_id", 2);
            c2.put("name", "张三");
            c2.put("kind", "person");
            c2.put("channel", "wechat");
            c2.put("target", null);
            c2.put("note", null);
            c2.put("created_at", null);
            Map<Long, List<Map<String, Object>>> bulk = new HashMap<>();
            bulk.put(1L, List.of(c1));
            bulk.put(2L, List.of(c2));
            when(contactStore.listContactsBulk(anyList())).thenReturn(bulk);

            mvc.perform(get("/api/tasks").param("limit", "5"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.items.length()").value(3))
                    // 1 群 1 人 来自不同 task 的 contact 列表
                    .andExpect(jsonPath("$.items[0].contacts[0].name").value("项目组"))
                    .andExpect(jsonPath("$.items[0].contacts[0].kind").value("group"))
                    .andExpect(jsonPath("$.items[1].contacts[0].name").value("张三"))
                    .andExpect(jsonPath("$.items[1].contacts[0].kind").value("person"))
                    // task 3 无 contact
                    .andExpect(jsonPath("$.items[2].contacts.length()").value(0));

            // 关键断言：批量调用 1 次（不是 3 次 listContacts 单查）
            verify(contactStore, times(1)).listContactsBulk(anyList());
            verify(contactStore, never()).listContacts(anyInt());
        }

        @Test
        @DisplayName("0 task → listContactsBulk 仍被调一次（id 列表为空）")
        void emptyRowsStillCallsBulk() throws Exception {
            when(taskStore.listTasksPaged(any(), any(), any(), any(), any(), any(), any()))
                    .thenReturn(List.of());
            when(taskStore.countTasks(any(), any(), any(), any(), any())).thenReturn(0L);
            when(contactStore.listContactsBulk(anyList())).thenReturn(Map.of());

            mvc.perform(get("/api/tasks"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.items.length()").value(0))
                    .andExpect(jsonPath("$.total").value(0));

            verify(contactStore, times(1)).listContactsBulk(anyList());
        }
    }
}

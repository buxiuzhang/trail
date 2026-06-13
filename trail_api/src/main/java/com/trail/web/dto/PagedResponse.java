package com.trail.web.dto;

import java.util.List;

/** 分页响应包装：{ items, total }。total 与 items 共享同一 WHERE 条件。 */
public record PagedResponse<T>(List<T> items, long total) {}

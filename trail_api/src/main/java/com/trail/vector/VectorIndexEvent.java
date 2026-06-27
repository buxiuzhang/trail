package com.trail.vector;

/**
 * 向量索引事件。写入点发布，VectorIndexListener 异步消费。
 * 失败对主流程无感知。
 */
public sealed interface VectorIndexEvent permits VectorIndexEvent.Upsert, VectorIndexEvent.Delete {

    /** 写入或更新一条向量（id、来源标签、待嵌入文本）。 */
    record Upsert(String id, String source, String text) implements VectorIndexEvent {}

    /** 删除一条向量。 */
    record Delete(String id) implements VectorIndexEvent {}
}

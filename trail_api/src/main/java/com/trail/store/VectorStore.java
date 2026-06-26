package com.trail.store;

import com.lancedb.lance.Dataset;
import com.lancedb.lance.WriteParams;
import com.lancedb.lance.ipc.ScanOptions;
import org.apache.arrow.c.ArrowArrayStream;
import org.apache.arrow.c.Data;
import org.apache.arrow.memory.BufferAllocator;
import org.apache.arrow.memory.RootAllocator;
import org.apache.arrow.vector.*;
import org.apache.arrow.vector.complex.ListVector;
import org.apache.arrow.vector.complex.impl.UnionListWriter;
import org.apache.arrow.vector.ipc.ArrowStreamReader;
import org.apache.arrow.vector.types.FloatingPointPrecision;
import org.apache.arrow.vector.types.pojo.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

/**
 * LanceDB 向量存储。
 *
 * 表结构：
 *   id         VARCHAR   — 来源标识，格式 "log:{id}" / "task:{id}" 等
 *   source     VARCHAR   — 来源类型
 *   text       VARCHAR   — 原始文本
 *   vector     LIST<f32> — embedding 向量
 *   created_at VARCHAR   — ISO 日期
 */
@Component
public class VectorStore {

    private static final Logger log = LoggerFactory.getLogger(VectorStore.class);
    private static final String TABLE_NAME = "embeddings";

    private final BufferAllocator allocator = new RootAllocator();
    private volatile Path vectorDir;
    private volatile Dataset dataset;

    /** 由 StartupChecks / DataDirService 在数据目录就绪后调用 */
    public synchronized void open(Path dataDir) {
        if (this.vectorDir != null) {
            close();
        }
        this.vectorDir = dataDir.resolve("vectors");
        try {
            Files.createDirectories(vectorDir);
        } catch (IOException e) {
            log.warn("创建 vectors/ 目录失败: {}", e.getMessage());
            return;
        }
        Path tablePath = vectorDir.resolve(TABLE_NAME + ".lance");
        try {
            if (Files.exists(tablePath)) {
                dataset = Dataset.open(tablePath.toString(), allocator);
                log.info("LanceDB dataset opened: {} ({} rows)", tablePath, dataset.countRows());
            } else {
                log.info("LanceDB dataset will be created on first write: {}", tablePath);
            }
        } catch (Exception e) {
            log.warn("LanceDB open 失败: {}", e.getMessage());
        }
    }

    public synchronized void close() {
        if (dataset != null) {
            try { dataset.close(); } catch (Exception ignored) {}
            dataset = null;
        }
    }

    @PreDestroy
    public void shutdown() {
        close();
        try { allocator.close(); } catch (Exception ignored) {}
    }

    /**
     * 写入一条向量记录（upsert by id）。
     */
    public synchronized void upsert(String id, String source, String text, float[] vector) {
        if (vectorDir == null) {
            throw new com.trail.store.exception.DataDirNotConfiguredException();
        }
        Path tablePath = vectorDir.resolve(TABLE_NAME + ".lance");
        Schema schema = buildSchema(vector.length);

        try (VectorSchemaRoot root = VectorSchemaRoot.create(schema, allocator)) {
            root.allocateNew();

            // 字符串字段
            ((VarCharVector) root.getVector("id")).setSafe(0, id.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            ((VarCharVector) root.getVector("source")).setSafe(0, source.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            ((VarCharVector) root.getVector("text")).setSafe(0, text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            ((VarCharVector) root.getVector("created_at")).setSafe(0,
                    java.time.LocalDate.now().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));

            // 向量字段（LIST<FLOAT32>）
            ListVector listVec = (ListVector) root.getVector("vector");
            UnionListWriter writer = listVec.getWriter();
            writer.startList();
            for (float v : vector) {
                writer.float4().writeFloat4(v);
            }
            writer.endList();
            listVec.setValueCount(1);

            root.setRowCount(1);

            byte[] ipcBytes = toIpcBytes(root);

            if (!Files.exists(tablePath)) {
                // 首次创建
                try (ArrowArrayStream stream = buildArrowStream(ipcBytes)) {
                    dataset = Dataset.create(allocator, stream, tablePath.toString(),
                            new WriteParams.Builder().build());
                }
                log.info("LanceDB dataset created: {}", tablePath);
            } else {
                // upsert：先删旧记录，再追加
                if (dataset == null) {
                    dataset = Dataset.open(tablePath.toString(), allocator);
                }
                String safeId = id.replace("'", "''");
                try { dataset.delete("id = '" + safeId + "'"); } catch (Exception ignored) {}

                try (ArrowArrayStream stream = buildArrowStream(ipcBytes)) {
                    Dataset.create(allocator, stream, tablePath.toString(),
                            new WriteParams.Builder()
                                .withMode(WriteParams.WriteMode.APPEND)
                                .build());
                }
                // 重新打开以刷新引用
                dataset.close();
                dataset = Dataset.open(tablePath.toString(), allocator);
            }
        } catch (Exception e) {
            log.error("VectorStore.upsert 失败 id={}: {}", id, e.getMessage(), e);
            throw new RuntimeException("向量写入失败: " + e.getMessage(), e);
        }
    }

    /** 列出所有记录 id（调试用） */
    public List<String> listIds() {
        if (dataset == null) return List.of();
        List<String> ids = new ArrayList<>();
        try {
            ScanOptions opts = new ScanOptions.Builder()
                    .columns(List.of("id"))
                    .build();
            try (var reader = dataset.newScan(opts).scanBatches()) {
                while (reader.loadNextBatch()) {
                    VectorSchemaRoot batch = reader.getVectorSchemaRoot();
                    VarCharVector vec = (VarCharVector) batch.getVector("id");
                    for (int i = 0; i < batch.getRowCount(); i++) {
                        if (!vec.isNull(i)) ids.add(new String(vec.get(i), java.nio.charset.StandardCharsets.UTF_8));
                    }
                }
            }
        } catch (Exception e) {
            log.warn("VectorStore.listIds 失败: {}", e.getMessage());
        }
        return ids;
    }

    public long countRows() {
        if (dataset == null) return 0;
        try { return dataset.countRows(); } catch (Exception e) { return 0; }
    }

    // ── helpers ────────────────────────────────────────────────────────────

    private Schema buildSchema(int dim) {
        return new Schema(List.of(
            new Field("id",         FieldType.nullable(ArrowType.Utf8.INSTANCE), null),
            new Field("source",     FieldType.nullable(ArrowType.Utf8.INSTANCE), null),
            new Field("text",       FieldType.nullable(ArrowType.Utf8.INSTANCE), null),
            new Field("created_at", FieldType.nullable(ArrowType.Utf8.INSTANCE), null),
            new Field("vector",
                FieldType.nullable(new ArrowType.List()),
                List.of(new Field("item",
                    FieldType.nullable(new ArrowType.FloatingPoint(FloatingPointPrecision.SINGLE)),
                    null)))
        ));
    }

    private byte[] toIpcBytes(VectorSchemaRoot root) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (var writer = new org.apache.arrow.vector.ipc.ArrowStreamWriter(root, null, out)) {
            writer.start();
            writer.writeBatch();
            writer.end();
        }
        return out.toByteArray();
    }

    private ArrowArrayStream buildArrowStream(byte[] ipcBytes) throws IOException {
        ArrowStreamReader reader = new ArrowStreamReader(new ByteArrayInputStream(ipcBytes), allocator);
        ArrowArrayStream stream = ArrowArrayStream.allocateNew(allocator);
        Data.exportArrayStream(allocator, reader, stream);
        return stream;
    }
}

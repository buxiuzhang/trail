package com.trail.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Anthropic 工具定义
 * 遵循 Anthropic Messages API 的 tools 参数格式
 */
public record Tool(
    String name,
    String description,
    InputSchema input_schema
) {
    public record InputSchema(
        String type,
        ObjectNode properties,
        java.util.List<String> required
    ) {}

    /**
     * 序列化为 Anthropic API 所需的 JSON 格式
     */
    public ObjectNode toJson(ObjectMapper mapper) {
        ObjectNode node = mapper.createObjectNode();
        node.put("name", name);
        node.put("description", description);
        ObjectNode schema = mapper.createObjectNode();
        schema.put("type", input_schema.type());
        schema.set("properties", input_schema.properties());
        if (input_schema.required() != null && !input_schema.required().isEmpty()) {
            schema.set("required", mapper.valueToTree(input_schema.required()));
        }
        node.set("input_schema", schema);
        return node;
    }
}

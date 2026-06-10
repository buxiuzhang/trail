package com.trail.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** 对接渠道 DTO（request + response 共用，靠 null id 区分新建/已有）。 */
public record ContactDto(
        Long id,
        @NotBlank String name,
        @Pattern(regexp = "group|person|email|phone|other",
                 message = "kind 必须是 group/person/email/phone/other") String kind,
        @Pattern(regexp = "dingtalk|wechat|elink|lark|feishu|email|phone|other",
                 message = "channel 必须是 dingtalk/wechat/elink/lark/feishu/email/phone/other") String channel,
        String target,
        String note,
        String createdAt
) {}

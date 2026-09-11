# ADR 0012：身份、视角与 owner Port 契约

状态：已接受，2026-11-02。细化 [ADR 0003](0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md)、[ADR 0004](0004-LOCAL-DISCOVERY-AND-INJECTION.md) 与 [ADR 0011](0011-EFFECT-CONTRACTS-AND-LIFETIME.md)。

## 决策

Artifact 是不透明流式边界载荷，不是 Workspace 实体；存储后的 ArtifactReference 携带稳定 ID，不能为判断值相等而缓冲文件流。

Workspace/Game/Host/Installation 是具有稳定 UUID 身份的实体。DiscoveryObservation、ExternalIdentity、scope、证据、来源、LocationContract 与 Binding Plan 是按所定义内容比较的值。Extension 发现观察、Game 准入候选和 Workspace 持久记录通过显式转换衔接。observationKey 标识来源观察，UUID candidateId 标识审核候选，两者都不是 Game ID。新增对象必须说明实体/值分类、比较语义与跨视角转换。DTO 传输数据，领域值/Schema 维护不变量，领域服务判断匹配/冲突，应用服务协调绑定/审核/持久化。

Extension 签发不透明 {issuer,purpose,value} 外部身份。issuer 必须等于所选 Adapter owner ID，purpose 区分 game 与 installation；业务服务比较完整值，不解析厂商 key。展示 externalRefs、路径、标题和优先级不构成身份。Steam 校验清单 AppID 与文件名一致后，签发 issuer 为 konogame.steam、value 为 app:<AppID> 的 game 身份，不推导账户归属或安装身份。filesystem 使用单独暴露的正数卷/文件对象 ID，在 Host 作用域内结合可用的正数出生时间签发 installation 身份。路径、可变 size/mtime/ctime 和目录证据指纹不进入该身份；缺少可靠文件对象 ID 时不签发。文件对象证据只限本地 Host/卷，不认证远端存储或克隆文件系统。

公共纯契约放在 owner 包的 /contracts 子路径。infrastructure 拥有声明/Artifact/Location，Game 拥有发现，Workspace 拥有配置/历史，Save 拥有各自 Port。移除独立共享 contracts 包与经 infrastructure 转导出的业务契约；这些入口不加载实现。各 Port 独立维护协议：Feature portContractVersion 与 Adapter portContractRange 在执行前协商，并保留在 Binding Plan；声明协议 contractRange 独立保留。game.discovery 升为 0.3.0（>=0.3.0 <0.4.0），其余已有 Port 保持 0.2.0。规范元数据与发布工具维护生成版本，Core 包仍统一发行，各 Extension 仍独立发行。

Core 与业务模块不持有厂商枚举、解析器、路径语义、厂商优先级或实现导入。组合入口可选择可选内置 Extension；CLI 目录到 Artifact 的转换由组合入口选择，通过窄服务注入，保留惰性导入。第三方 Extension 走相同契约、身份校验和惰性绑定流程。

## 影响

实验阶段允许破坏旧观察和 Port 声明。不增加猜测式迁移或旧读取器，保留用户数据并报告不兼容记录。合成第三方流程测试应覆盖身份复用、冲突、issuer 拒绝、安装身份与不启用内置来源时的惰性加载。验证行为，不验证源码布局/导出清单。Schema 4 与发行版本不变。

[English](../../en/adr/0012-IDENTITY-PERSPECTIVES-AND-PORT-CONTRACTS.md) | [中文](0012-IDENTITY-PERSPECTIVES-AND-PORT-CONTRACTS.md)

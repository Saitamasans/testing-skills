# 深度分析手册：从声明到可追溯测试地图

仅在有实际 JS 文本时加载。没有正文先报告缺口，不用页面外观补造代码。这里复用旧 Stage 3 的分析思路，不调用其执行器。

## 1. 先选择值得分析的代码

记录六项依据：当前页面/批次相关性、第一方可信度、实际加载证据、关系丰富度、风险行为、信息新颖度。每项写证据或 unknown，不虚构分数。

- HIGH：当前任务相关业务 handler/service，含路由、请求、状态或权限条件。深入代表性链。
- MEDIUM：有业务声明但入口关联不足；恢复局部结构，不强行扩展 L3。
- LOW：通用库、重复代码或无新增信息；只记版本/用途线索，不逐函数解释 vendor。

“来自同域”“文件叫 app.js”“包含 API 字样”均不足以单独证明第一方业务代码。未发生加载观察不能填 runtime_loaded=true。

## 2. 先做符号账本，再串链

对每个已读文件记录 import/export、函数/对象方法定义、路由声明、事件绑定、请求声明、权限条件、状态条件、返回值和错误处理位置。区分同名符号的作用域；alias 只有绑定关系可见才展开。

边分三类：代码可见的直接调用、由明确 import/alias 解析的调用、未解析动态调用。第三类留下缺口，不连成确定边。

界面入口只在 DOM 绑定或路由组件映射可见时关联函数。函数名 loadOrders 不证明它一定由当前页面触发；定义存在不等于已执行。

## 3. 分支不能扁平化

例如：

    if (order.status !== 2) return;
    if (!permissions.includes("orders:cancel")) return;
    const response = await apiClient.request({url: "/api/order/cancel", method: "POST"});
    if (response.ok) await reloadDetail();
    else showError("cancel failed");

应恢复：状态条件 true→停止、false→权限条件；权限条件 true→停止、false→请求声明；response.ok true→reloadDetail，false→showError。reloadDetail 与 showError 是互斥分支，不是先后调用。

可说“前端存在两道提前返回条件”。不能说“状态 2 就是已审核”“后端已实施权限校验”“当前用户可以取消”。POST 只做静态分析，不点击取消验证。

## 4. 公共请求层保留影响测试的分支

只有同一可追溯控制流出现 401 条件→refresh→使用原 config 再请求，才记录静态恢复候选。若 refresh 在另一个 featureFlag 分支里，不能因三个关键词共存而声称 401 自动恢复。

框架转发层可折叠，但保留身份恢复、错误转换、重试次数、缓存等影响测试的层。请求包装器本身若只是 fixture/stub（如直接 return config），必须说明没有实际传输证据；请求配置不是网络请求实测。

## 5. Source Map、Chunk 与动态边界

script src/import/Map 注释只是指针。分别记录 discovered、body_read、mapped、unresolved；不能将找到路径算完成分析。只根据已取得的 Map mappings 与源位置对应关系升级定位；优先保留生成文件位置作可复核后备。

动态 import 参数、运行时注册表、混淆表达式不能解出时停止局部链，记录未解析表达式与原因。不得自行猜 chunk URL 或业务 API。

## 6. 五种停止原因

business_loop_closed：输入/条件/请求声明/反馈已形成代表链。
framework_boundary：继续只剩与测试无关的库内部。
no_new_test_information：新增展开不改变测试认识。
front_end_observable_boundary：后端实现/服务端规则无证据。
evidence_insufficient：缺源码、动态目标不明或内容被截断。

一次局部停止不终止其他模块；预算与断点写进结果。

## 7. 从技术事实形成测试认知

每个测试重点写：技术依据→可能影响→待验证问题→建议验证方式（不执行）。如权限提前返回，可建议比较不同权限账号，但不能标记越权已验证。UI 字段名来自运行观察；接口方法/路径来自静态声明；二者关联没有桥接证据时标 inferred。

身份稳定：实体 identity 为来源+符号/路由+类型；revision 为实际内容变化。不能仅因行号移动就认定新业务。保留同 run_id 的证据引用；presentation 不能改方法、路径、分支或状态。

## 8. 落到可视化地图

分析结束必须写出 `evidence/map.json`，不要停在符号账本或 Word。

- 每个 HIGH 业务链 → `flows[]` 里一张小图；节点是页面/步骤，边是动词。
- 模块关系单独放 `modules` + `module_edges`。
- `status`：看见了=observed，只在代码里=static，有依据猜的=inferred，材料不够=unverified。缺省不要填 observed。
- 汇合/回头边不要放进 `edges`，写进目标节点的 `unverified`。
- 然后渲染 `map.html`。没有图，本轮分析不算完成。

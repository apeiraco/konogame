# ADR 0010：测试边界与构建任务图

状态：已接受，2026-10-19。

## 背景

目录本身不能解释测试边界。子进程导入 `runCli` 只是执行工具：帮助、参数和拒绝提示覆盖一个入口，rename 或 inspect 覆盖 Workspace 流程。统一的 Vitest 时限也没有体现单个服务、完整用户流程与已构建程序的成本差异。执行导出选择 `dist`，测试需要最新的依赖产物。

## 决策

按所证明的流程分类。单元测试负责一条规则或一个服务，包括正常路径和失败。在内存中组合该服务已声明的依赖，或用真实目录验证一个 Adapter，仍是单元测试。集成测试是完整用户流程，或该流程中已经识别的失败，例如发现准入、Workspace 重命名/导入/编辑恢复、写入协调，以及写入前取消。集成测试不启动进程。端到端测试只保留测试进程观察不到的一种行为，并让这一组观察只启动一次进程：导入副作用、已构建程序自己的 argv、真实终端、进程崩溃，或会污染后续导入的解析钩子。已构建 argv 冒烟和真实终端不接收注入的服务，也不伪造 `isTTY`。子进程不能决定类别：CLI 帮助、参数、JSON 和拒绝提示是入口的单元覆盖；会选择或写入 Workspace 记录的 rename 或 inspect 留在进程内，除非要观察的就是崩溃本身。命令矩阵在测试进程内调用导出的运行函数。Effect 延时使用 TestClock。合成夹具和受控故障前置设置仍适用。

Vitest 继续负责测试。单元测试位于 `src/**/__tests__/`，集成测试位于 workspace 或仓库 `tests/integration/`，端到端测试位于 workspace 或仓库 `tests/e2e/`。单元与集成 worker 使用隔离 fork。进程内测试替换所有者 I/O 端口，或使用 `temp/tests/` 中的真实目录。不挂载虚拟文件系统。子进程测试及原生文件系统语义使用 `temp/tests/` 一次性目录。

单元、集成和端到端文件使用同一套 worker 策略，一起并行。Vitest 5 只在 worker 上限不同时才要求分组。`just test --shard=1/N` 把同一套文件切给 CI；每一片仍等待同一次可缓存的 `^build`。

execa 负责启动程序与获取输出/状态。`cli-testing-library` 观察管道中的 CLI 输出，其 spawn transport 不是 PTY。少量真实终端测试使用 `node-pty` 覆盖键盘输入、可见提示与取消，不伪造 `isTTY`。注入 prompt 测试覆盖命令路由，以及写入流程中的取消。保留该库上游 Windows CI 警告，这是 `cli-testing-library` 自身的说明，不是已经证明的 `node-pty` 限制。不能用管道或注入测试通过证明终端支持。`cli-testing-library` 独立维护，不属于 Testing Library 组织。

Turborepo 声明产物依赖：workspace `build` 依赖其依赖包的 `^build`，输出 `dist/**`；根 `test:run` 依赖 `^build`，始终执行且不缓存。`just build`、`just test` 和 `just check` 的测试阶段通过 pnpm 进入任务图。测试筛选参数只进入 Vitest，不传给依赖构建。声明共享配置与环境输入，在本地缓存构建产物；不把测试成功输出缓存作为执行的替代。TypeScript references 图和 `dist-tsc/` 仍由根目录单次 `tsc --build` 管理。

`just cli`、`just daemon`、`just dev-cli` 继续在显式构建后直接运行 Node 产物，保证 JSON 输出干净。不新增任务调度器。

## 影响

[开发指南](../004-DEVELOPMENT.md)记录各项目时限、调度、命令与夹具约定。进程只是执行工具，不能定义测试类别。真实用户流程验证交付入口与文件；注入脚本覆盖一个命令表面，或一条已经识别的流程失败，不据此声称终端或文件系统保证。不改变 Schema 与发行版本。

## 参考

- [Turborepo 任务依赖与输出](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks)
- [Vitest 文件并行与项目排序](https://vitest.dev/guide/recipes/parallel-sequential)
- [cli-testing-library 与平台限制](https://github.com/crutchcorn/cli-testing-library)

[English](../../en/adr/0010-TEST-BOUNDARIES-AND-TASK-GRAPH.md) | [中文](0010-TEST-BOUNDARIES-AND-TASK-GRAPH.md)

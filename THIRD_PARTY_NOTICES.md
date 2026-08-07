# Third-Party Notices

## Superpowers

Zimster reuses and adapts selected workflow language, plugin manifests, the
cross-platform hook wrapper, and the OpenCode and Pi bootstrap adapters from
[Superpowers](https://github.com/obra/superpowers), version 6.2.0.

MIT License

Copyright (c) 2025 Jesse Vincent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## OpenAI Codex plugin contract

Zimster includes a compact JavaScript port and machine-readable snapshot of the
official OpenAI Codex plugin-creator validation contract. Source paths and the
pinned blob SHA are recorded under
`vendor/openai-codex-plugin-validator/`. The upstream project is licensed under
the Apache License 2.0; the vendored license text is at
`vendor/openai-codex-plugin-validator/LICENSE`.

Copyright OpenAI and contributors.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this material except in compliance with the License. You may obtain a copy at
<https://www.apache.org/licenses/LICENSE-2.0>.

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied.

## Agent Plugins specification and Agent Skills specification

Zimster's portable validation rules derive from the Agent Plugins 1.0.0
specification and schema at commit
`1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1`. The schema and software are
licensed under Apache-2.0; specification prose and examples are licensed under
CC-BY-4.0.

The Agent Skills validation rules derive from the specification at commit
`217be548739f21d6008915c29aefe320ea1a90af`, licensed under Apache-2.0.

## Other researched projects

OpenSpec, GitHub Spec Kit, Agent OS, BMAD, Ralph, GSD, Ruflo, metaswarm,
Smithers, Microsoft Conductor, Trellis, and Task Master informed comparative
research in `docs/RESEARCH.md`. No code from those projects is included. Task
Master code is specifically excluded because its current Commons Clause
restricts competing products.

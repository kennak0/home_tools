# 開発環境コンテナ

https://github.com/devcontainers/images/blob/main/src/base-debian/.devcontainer/Dockerfile
のコンテナをベースに

https://containers.dev/
に従って devcontainer の仕様に則り作成している。
ベースコンテナを外部から持ってきてしまうと、rootless コンテナが起動しないため、ベースイメージを Dockerfile として使用している。

https://github.com/devcontainers/features/tree/main/src

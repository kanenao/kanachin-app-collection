# LIVE Ranking Server 安定版自動更新

自宅サーバー専用。Cloudflare本体のリビジョンとは別管理。

- 初回導入版：v0.4.7（自動更新エンジンをローカルに導入）。
- 公開中の安定版は manifest.json の version。
- 更新確認：起動30秒後、その後15分間隔。
- 次版はユーザーの新規ダウンロードを不要にするため、この配布先へ登録すること。

## 次版の公開手順

1. 最新版の実行ソースを用意し、server.cjs の VERSION と画面のバージョンを更新。
2. 既存テストを実行。自動更新対応版の make-update.cjs を使い、`node make-update.cjs 0.4.8 <新版フォルダ> <配布出力フォルダ>` の形式で生成する。バージョンは実際の新版に合わせる。
3. 生成された v0.4.8.json をこのディレクトリに新規登録し、GitHubで内容とSHA-256を照合。既存公開済みのバンドルは変更しない。
4. 最後に生成された manifest.json を反映する。テスト失敗時やバンドル未公開時はmanifestを変更しない。

schema: 1、channel: stable、version: X.Y.Z、bundle: vX.Y.Z.json、sha256: 64桁小文字16進数。バンドルには server.cjs、dashboard.html、details.cjs、thumbnails.cjs、image-relay.cjs、live-stats.cjs と既存6種のテストのみ。データ、秘密情報、起動スクリプトを含めない。2MiB上限。

更新は固定GitHub HTTPS配布元を信頼し、ハッシュ・構文・模擬テストを照合して別ディレクトリへ展開。起動確認に失敗すると直前版へ戻す。実環境の全機能を保証する仕組みではなく、署名による独立した真正性確認は未実装。更新エンジンの変更は別途導入が必要。公開元アカウントの保護を重視する。

初期manifestはv0.4.7であり、現時点では新版バンドルはまだ公開していない。

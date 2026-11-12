# Local data-only publisher stopped before any write

12 November 2026. The first local publisher could not connect to api.github.com
on its first read of v0.1.0. Its only command exited 1 with the original 94-byte
connection error. No release creation/upload/publish request was reached; no
release ID or successful API response exists in this invocation. Do not call it
a publication or permission denial. [The retained report](sdk-publication-attempt-1.json)
keeps the complete command streams; only its absolute local workspace prefix in
traceback is redacted, with the original hash and private preservation stated.

Continue the same reviewed-data publication in its explicitly approved free
temporary CI boundary. There is no SDK rebuild, package replay, new credential,
auth change or local network retry. Pin the tarball and qualification inputs;
verify the old release and absence of v0.1.1 again before any write. The original
failed report remains immutable. Existing connector reads and CI retirement API
calls worked; this observation does not establish the local network failure's
underlying cause.

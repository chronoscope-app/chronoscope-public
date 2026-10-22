//! Limit stdio frames before the SDK's newline decoder buffers them.
use std::{
    io,
    pin::Pin,
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, ReadBuf};
pub struct Lines<R> {
    pub reader: R,
    pub bytes: usize,
}
impl<R: AsyncRead + Unpin> AsyncRead for Lines<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        out: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let mut storage = [0u8; 8192];
        let cap = out.remaining().min(storage.len());
        let mut buf = ReadBuf::new(&mut storage[..cap]);
        match Pin::new(&mut self.reader).poll_read(cx, &mut buf) {
            Poll::Ready(Ok(())) => {
                for byte in buf.filled() {
                    if *byte == b'\n' {
                        self.bytes = 0;
                    } else {
                        self.bytes += 1;
                        if self.bytes > 2 * 1024 * 1024 {
                            return Poll::Ready(Err(io::Error::other(
                                "MCP stdio frame exceeds 2 MiB",
                            )));
                        }
                    }
                }
                out.put_slice(buf.filled());
                Poll::Ready(Ok(()))
            }
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Lines;
    use tokio::io::AsyncReadExt;
    #[test]
    fn rejects_an_unterminated_oversize_frame_and_resets_on_newlines() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let input = vec![b'x'; 2 * 1024 * 1024 + 1];
            let mut reader = Lines {
                reader: input.as_slice(),
                bytes: 0,
            };
            let mut output = vec![];
            assert!(reader.read_to_end(&mut output).await.is_err());
            assert!(output.len() <= 2 * 1024 * 1024);
            let mut framed = vec![b'x'; 2 * 1024 * 1024];
            framed.push(b'\n');
            framed.extend(vec![b'y'; 2 * 1024 * 1024]);
            framed.push(b'\n');
            let mut reader = Lines {
                reader: framed.as_slice(),
                bytes: 0,
            };
            let mut output = vec![];
            reader.read_to_end(&mut output).await.unwrap();
            assert_eq!(output, framed);
        });
    }
}

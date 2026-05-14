import type { MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";

function encodeSSE(data: object): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

export function createSSEStream(
  stream: AsyncIterable<MessageStreamEvent>
): ReadableStream {
  let fullText = "";

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const text = event.delta.text;
            fullText += text;
            controller.enqueue(
              encodeSSE({ type: "text_delta", text })
            );
          }
        }

        controller.enqueue(
          encodeSSE({ type: "done", text: fullText })
        );
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown streaming error";
        controller.enqueue(
          encodeSSE({ type: "error", error: message })
        );
        controller.close();
      }
    },
  });
}

import { NextRequest } from "next/server";
import { downloads } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return new Response("Missing id", { status: 400 });
  }

  const dl = downloads.get(id);
  if (!dl) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send current state immediately
      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      send(JSON.stringify({ type: "progress", progress: dl.progress, speed: dl.speed, eta: dl.eta }));

      if (dl.status === "done") {
        send(JSON.stringify({ type: "done" }));
        controller.close();
        return;
      }
      if (dl.status === "error") {
        send(JSON.stringify({ type: "error", message: dl.error }));
        controller.close();
        return;
      }

      const cb = (line: string) => {
        try {
          send(line);
          const parsed = JSON.parse(line);
          if (parsed.type === "done" || parsed.type === "error") {
            dl.subscribers.delete(cb);
            controller.close();
          }
        } catch {
          // ignore
        }
      };

      dl.subscribers.add(cb);

      req.signal.addEventListener("abort", () => {
        dl.subscribers.delete(cb);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

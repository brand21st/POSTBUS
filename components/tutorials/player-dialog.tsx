"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { TutorialPublic } from "@/types/api";

export function TutorialPlayerDialog({
  tutorial,
  onOpenChange,
}: {
  tutorial: TutorialPublic | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = Boolean(tutorial);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-4 p-0 sm:p-0">
        {tutorial ? (
          <>
            <div className="aspect-video overflow-hidden rounded-t-2xl bg-black">
              {tutorial.embedUrl ? (
                <iframe
                  title={tutorial.title}
                  src={tutorial.embedUrl}
                  className="h-full w-full"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : null}
            </div>
            <div className="px-6 pb-6">
              <DialogHeader className="pr-8">
                <DialogTitle>{tutorial.title}</DialogTitle>
                {tutorial.category ? (
                  <Badge variant="brand" className="w-fit">
                    {tutorial.category.name}
                  </Badge>
                ) : null}
                {tutorial.description ? (
                  <DialogDescription className="text-left">{tutorial.description}</DialogDescription>
                ) : (
                  <DialogDescription className="sr-only">YouTube tutorial video</DialogDescription>
                )}
              </DialogHeader>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ArticleEditor } from "@/components/knowledge/article-editor";
import { AttachmentsCard } from "@/components/attachments/attachments-card";
import { updateArticle } from "@/lib/actions/knowledge";
import { getMaxUploadMb } from "@/lib/settings";

export const metadata: Metadata = { title: "Edit article" };
export const dynamic = "force-dynamic";

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireRole("AGENT");
  const { slug } = await params;
  const [article, categories] = await Promise.all([
    db.article.findUnique({ where: { slug }, include: { attachments: { orderBy: { createdAt: "desc" } } } }),
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!article) notFound();

  const maxUploadMb = await getMaxUploadMb();

  return (
    <>
      <PageHeader
        icon={BookOpen}
        title="Edit article"
        description="Each save creates a new revision in the article history."
      />
      <PageBody>
        <Card className="mx-auto max-w-5xl">
          <CardContent>
            <ArticleEditor
              action={updateArticle}
              categories={categories}
              submitLabel="Save changes"
              defaults={{
                id: article.id,
                title: article.title,
                excerpt: article.excerpt ?? "",
                body: article.body,
                bodyFormat: article.bodyFormat,
                categoryId: article.categoryId,
                visibility: article.visibility,
              }}
            />
          </CardContent>
        </Card>

        <div className="mx-auto mt-4 max-w-5xl">
          <AttachmentsCard
            attachments={article.attachments}
            target={{ articleId: article.id }}
            canUpload
            canDeleteAll
            maxMb={maxUploadMb}
          />
        </div>
      </PageBody>
    </>
  );
}

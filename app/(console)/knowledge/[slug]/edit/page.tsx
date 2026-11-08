import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { db } from "@/lib/db";
import { hasRole, requireRole } from "@/lib/session";
import { statusAfterEdit } from "@/lib/article-rules";
import { getT } from "@/lib/i18n/server";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ArticleEditor } from "@/components/knowledge/article-editor";
import { AttachmentsCard } from "@/components/attachments/attachments-card";
import { updateArticle } from "@/lib/actions/knowledge";
import { getMaxUploadMb } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("knowledge");
  return { title: t("editTitle") };
}
export const dynamic = "force-dynamic";

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const me = await requireRole("AGENT");
  const { slug } = await params;
  const [t, tc] = await Promise.all([getT("knowledge"), getT("common")]);
  const [article, categories] = await Promise.all([
    db.article.findUnique({ where: { slug }, include: { attachments: { orderBy: { createdAt: "desc" } } } }),
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!article) notFound();

  const maxUploadMb = await getMaxUploadMb();
  const sendsBackToReview = statusAfterEdit(article.status, hasRole(me.role, "MANAGER")) !== article.status;

  return (
    <>
      <PageHeader
        icon={BookOpen}
        title={t("editTitle")}
        description={t("editDescription")}
      />
      <PageBody>
        {sendsBackToReview ? (
          <p className="mx-auto mb-4 max-w-5xl rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
            {t("fourEyesHint")}
          </p>
        ) : null}
        <Card className="mx-auto max-w-5xl">
          <CardContent>
            <ArticleEditor
              action={updateArticle}
              categories={categories}
              submitLabel={tc("saveChanges")}
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

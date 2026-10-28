// Secure R2 image loader for Persora Forms (supports owner builder/response views and public slug views).
import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { fetchFormAssetBlobUrl, fetchPublicFormAssetBlobUrl } from "../../lib/forms-api";
import { Spinner } from "@/components/ui/spinner";

const blobCache = new Map<string, string>();

export default function FormImageAsset({
  assetId,
  formId,
  publicSlug,
  localPreviewUrl,
  alt = "Form image",
  className = "",
}: {
  assetId?: string;
  formId?: string;
  publicSlug?: string;
  localPreviewUrl?: string;
  alt?: string;
  className?: string;
}) {
  const cacheKey = localPreviewUrl
    ? `local:${localPreviewUrl}`
    : publicSlug
      ? `pub:${publicSlug}:${assetId}`
      : `own:${formId}:${assetId}`;

  const [src, setSrc] = useState<string | null>(() => localPreviewUrl || blobCache.get(cacheKey) || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (localPreviewUrl) {
      setSrc(localPreviewUrl);
      setFailed(false);
      return;
    }
    if (!assetId || (!formId && !publicSlug)) {
      setSrc(null);
      return;
    }
    const cached = blobCache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      setFailed(false);
      return;
    }
    let active = true;
    setFailed(false);
    const loader = publicSlug
      ? fetchPublicFormAssetBlobUrl(publicSlug, assetId)
      : fetchFormAssetBlobUrl(formId!, assetId);

    loader
      .then((objectUrl) => {
        blobCache.set(cacheKey, objectUrl);
        if (active) setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [assetId, formId, publicSlug, localPreviewUrl, cacheKey]);

  if (failed) {
    return (
      <div className={`pf-img-fallback ${className}`} role="img" aria-label={alt}>
        <ImageOff size={16} aria-hidden="true" />
        <span>Image unavailable</span>
      </div>
    );
  }

  if (!src) {
    return (
      <div className={`pf-img-loading ${className}`}>
        <Spinner className="size-4" />
      </div>
    );
  }

  return <img src={src} alt={alt} className={`pf-img ${className}`} loading="lazy" />;
}

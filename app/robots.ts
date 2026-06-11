import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/audit-themes", "/auth/"],
    },
    sitemap: "https://pokememory.com/sitemap.xml",
  };
}

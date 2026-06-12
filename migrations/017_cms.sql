BEGIN;

CREATE TABLE cms_pages (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    slug             VARCHAR(100) NOT NULL,
    title            VARCHAR(255) NOT NULL,
    content_html     TEXT         NOT NULL DEFAULT '',
    meta_description VARCHAR(300),
    is_published     BOOLEAN      NOT NULL DEFAULT FALSE,
    sort_order       INT          NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_cms_page_tenant_slug ON cms_pages(tenant_id, slug);
CREATE INDEX idx_cms_pages_tenant_published ON cms_pages(tenant_id, is_published, sort_order);

CREATE TABLE cms_announcements (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title        VARCHAR(255) NOT NULL,
    body         TEXT        NOT NULL,
    is_published BOOLEAN     NOT NULL DEFAULT FALSE,
    published_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cms_announcements_published
    ON cms_announcements(tenant_id, is_published, published_at DESC);

COMMIT;

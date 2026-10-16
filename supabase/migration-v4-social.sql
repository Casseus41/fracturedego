-- ════════════════════════════════════════════════════════════════════
--  fractured Ego — migration v4: Community (social layer)
-- ════════════════════════════════════════════════════════════════════
--  Run AFTER migration-v3.sql and patches 1–4. Idempotent: safe to re-run.
--
--  Model (decided by Cass):
--    • Every active member is automatically connected to every other.
--    • Member profiles are visible to all active members.
--    • Admins can see everything, including edited/deleted content
--      (preserved in content_archive).
--
--  Privacy boundary: the public face of a member lives in member_profiles.
--  Email, phone and legal name stay in the existing private profiles table.
--
--  Depends on existing: profiles(id, first_name, last_name, role, status,
--  created_at), is_admin(), requests(user_id, status), code_requests,
--  invite_requests. Triggers on the last three are added only if the
--  tables exist, and can never block the original write.
-- ════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
-- 1. TABLES
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.member_profiles (
  id            uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name  text NOT NULL DEFAULT 'Member' CHECK (char_length(display_name) BETWEEN 1 AND 60),
  pronouns      text CHECK (pronouns IS NULL OR char_length(pronouns) <= 30),
  headline      text CHECK (headline IS NULL OR char_length(headline) <= 120),
  location      text CHECK (location IS NULL OR char_length(location) <= 80),
  bio           text CHECK (bio IS NULL OR char_length(bio) <= 1000),
  interests     text[] NOT NULL DEFAULT '{}' CHECK (cardinality(interests) <= 12),
  avatar_path   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);

CREATE TABLE IF NOT EXISTS public.member_restrictions (
  user_id              uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  posting_suspended    boolean NOT NULL DEFAULT false,
  messaging_suspended  boolean NOT NULL DEFAULT false,
  reason               text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.member_blocks (
  blocker_id  uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS public.posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  body             text NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  image_path       text,
  is_announcement  boolean NOT NULL DEFAULT false,
  is_pinned        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  edited_at        timestamptz,
  CHECK (char_length(btrim(body)) > 0 OR image_path IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.post_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL DEFAULT auth.uid() REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz
);

CREATE TABLE IF NOT EXISTS public.post_reactions (
  post_id     uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  emoji       text NOT NULL CHECK (emoji IN ('heart','pray','spark','hug')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS public.conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_group         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id  uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  joined_at        timestamptz NOT NULL DEFAULT now(),
  last_read_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  body             text NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  CHECK (deleted_at IS NOT NULL OR char_length(btrim(body)) > 0)
);

CREATE TABLE IF NOT EXISTS public.reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id       uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_type       text NOT NULL CHECK (target_type IN ('post','comment','message','profile')),
  target_id         uuid NOT NULL,
  target_user_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason            text NOT NULL CHECK (reason IN ('harassment','unsafe','spam','impersonation','privacy','other')),
  details           text CHECK (details IS NULL OR char_length(details) <= 1000),
  content_snapshot  text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','actioned','dismissed')),
  admin_notes       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type        text NOT NULL,
  actor_id    uuid REFERENCES public.member_profiles(id) ON DELETE SET NULL,
  post_id     uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  comment_id  uuid REFERENCES public.post_comments(id) ON DELETE CASCADE,
  preview     text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Admin-only record of every edit and deletion (no FKs: survives deletes)
CREATE TABLE IF NOT EXISTS public.content_archive (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type      text NOT NULL CHECK (source_type IN ('post','comment','message')),
  source_id        uuid NOT NULL,
  action           text NOT NULL CHECK (action IN ('edit','delete')),
  author_id        uuid,
  post_id          uuid,
  conversation_id  uuid,
  body             text,
  image_path       text,
  actor_id         uuid,
  archived_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_posts_created        ON public.posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author         ON public.posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_pinned         ON public.posts (is_pinned) WHERE is_pinned;
CREATE INDEX IF NOT EXISTS idx_comments_post        ON public.post_comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reactions_post       ON public.post_reactions (post_id);
CREATE INDEX IF NOT EXISTS idx_participants_user    ON public.conversation_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv        ON public.messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_recent ON public.conversations (last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reports_status       ON public.reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archive_recent       ON public.content_archive (archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked       ON public.member_blocks (blocked_id);


-- ════════════════════════════════════════════════════════════════════
-- 2. HELPER FUNCTIONS (used by RLS policies)
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.member_is_active(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user
      AND coalesce(p.status, 'active') NOT IN ('inactive','suspended','banned','deactivated','deleted')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_active_member()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.member_is_active(auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.can_post()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.member_is_active(auth.uid())
     AND NOT EXISTS (SELECT 1 FROM public.member_restrictions r
                     WHERE r.user_id = auth.uid() AND r.posting_suspended)
$$;

CREATE OR REPLACE FUNCTION public.can_message()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.member_is_active(auth.uid())
     AND NOT EXISTS (SELECT 1 FROM public.member_restrictions r
                     WHERE r.user_id = auth.uid() AND r.messaging_suspended)
$$;

CREATE OR REPLACE FUNCTION public.is_blocked_between(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.member_blocks b
    WHERE (b.blocker_id = p_a AND b.blocked_id = p_b)
       OR (b.blocker_id = p_b AND b.blocked_id = p_a)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation AND cp.user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.conversation_has_block(p_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation
      AND cp.user_id <> auth.uid()
      AND public.is_blocked_between(auth.uid(), cp.user_id)
  )
$$;

-- Creates or refreshes a member's public profile from their private profile.
-- Only replaces the display name while it is still the default.
CREATE OR REPLACE FUNCTION public.ensure_member_profile(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_name text;
BEGIN
  SELECT nullif(btrim(coalesce(p.first_name, '') ||
           CASE WHEN nullif(btrim(p.last_name), '') IS NOT NULL
                THEN ' ' || left(btrim(p.last_name), 1) || '.' ELSE '' END), '')
    INTO v_name
    FROM public.profiles p WHERE p.id = p_user;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO public.member_profiles (id, display_name, created_at)
  SELECT p.id, left(coalesce(v_name, 'Member'), 60), coalesce(p.created_at, now())
    FROM public.profiles p WHERE p.id = p_user
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name
    WHERE public.member_profiles.display_name = 'Member' AND EXCLUDED.display_name <> 'Member';
END $$;


-- ════════════════════════════════════════════════════════════════════
-- 3. TRIGGER FUNCTIONS
-- ════════════════════════════════════════════════════════════════════

-- 3a. Keep member_profiles in step with profiles (never blocks signup)
CREATE OR REPLACE FUNCTION public.trg_profiles_sync_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.ensure_member_profile(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_profiles_sync_member: %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_sync_member ON public.profiles;
CREATE TRIGGER profiles_sync_member
  AFTER INSERT OR UPDATE OF first_name, last_name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_profiles_sync_member();

-- 3b. updated_at on member_profiles
CREATE OR REPLACE FUNCTION public.trg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS member_profiles_touch ON public.member_profiles;
CREATE TRIGGER member_profiles_touch BEFORE UPDATE ON public.member_profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_updated_at();

-- 3c. Archive post edits / deletes
CREATE OR REPLACE FUNCTION public.trg_posts_archive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.content_archive (source_type, source_id, action, author_id, post_id, body, image_path, actor_id)
    VALUES ('post', OLD.id, 'delete', OLD.author_id, OLD.id, OLD.body, OLD.image_path, auth.uid());
    RETURN OLD;
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.image_path IS DISTINCT FROM OLD.image_path THEN
    INSERT INTO public.content_archive (source_type, source_id, action, author_id, post_id, body, image_path, actor_id)
    VALUES ('post', OLD.id, 'edit', OLD.author_id, OLD.id, OLD.body, OLD.image_path, auth.uid());
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS posts_archive ON public.posts;
CREATE TRIGGER posts_archive BEFORE UPDATE OR DELETE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_posts_archive();

-- 3d. Archive comment edits / deletes
CREATE OR REPLACE FUNCTION public.trg_comments_archive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.content_archive (source_type, source_id, action, author_id, post_id, body, actor_id)
    VALUES ('comment', OLD.id, 'delete', OLD.author_id, OLD.post_id, OLD.body, auth.uid());
    RETURN OLD;
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    INSERT INTO public.content_archive (source_type, source_id, action, author_id, post_id, body, actor_id)
    VALUES ('comment', OLD.id, 'edit', OLD.author_id, OLD.post_id, OLD.body, auth.uid());
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS comments_archive ON public.post_comments;
CREATE TRIGGER comments_archive BEFORE UPDATE OR DELETE ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_comments_archive();

-- 3e. Messages: archive edits, blank deleted bodies (originals kept for admins)
CREATE OR REPLACE FUNCTION public.trg_messages_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.content_archive (source_type, source_id, action, author_id, conversation_id, body, actor_id)
    VALUES ('message', OLD.id, 'delete', OLD.sender_id, OLD.conversation_id, OLD.body, auth.uid());
    RETURN OLD;
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN          -- deleted messages are final
    NEW.deleted_at := OLD.deleted_at;
    NEW.body := OLD.body;
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    INSERT INTO public.content_archive (source_type, source_id, action, author_id, conversation_id, body, actor_id)
    VALUES ('message', OLD.id, 'delete', OLD.sender_id, OLD.conversation_id, OLD.body, auth.uid());
    NEW.body := '';
  ELSIF NEW.body IS DISTINCT FROM OLD.body THEN
    INSERT INTO public.content_archive (source_type, source_id, action, author_id, conversation_id, body, actor_id)
    VALUES ('message', OLD.id, 'edit', OLD.sender_id, OLD.conversation_id, OLD.body, auth.uid());
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_guard ON public.messages;
CREATE TRIGGER messages_guard BEFORE UPDATE OR DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_messages_guard();

-- 3f. New message → bump conversation, mark read for the sender
CREATE OR REPLACE FUNCTION public.trg_messages_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  UPDATE public.conversation_participants SET last_read_at = NEW.created_at
   WHERE conversation_id = NEW.conversation_id AND user_id = NEW.sender_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_after_insert ON public.messages;
CREATE TRIGGER messages_after_insert AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_messages_after_insert();

-- 3g. Reports: stamp reporter, snapshot the content, refuse targets the
--     reporter cannot actually see (prevents fishing for private content)
CREATE OR REPLACE FUNCTION public.trg_reports_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid(); v_conv uuid;
BEGIN
  IF v_me IS NOT NULL THEN NEW.reporter_id := v_me; END IF;
  NEW.status := 'pending'; NEW.resolved_at := NULL; NEW.resolved_by := NULL; NEW.admin_notes := NULL;

  IF NEW.target_type = 'post' THEN
    SELECT p.author_id, left(p.body, 2000) || CASE WHEN p.image_path IS NOT NULL THEN ' [image: ' || p.image_path || ']' ELSE '' END
      INTO NEW.target_user_id, NEW.content_snapshot FROM public.posts p WHERE p.id = NEW.target_id;
  ELSIF NEW.target_type = 'comment' THEN
    SELECT c.author_id, left(c.body, 2000)
      INTO NEW.target_user_id, NEW.content_snapshot FROM public.post_comments c WHERE c.id = NEW.target_id;
  ELSIF NEW.target_type = 'message' THEN
    SELECT m.sender_id, left(m.body, 2000), m.conversation_id
      INTO NEW.target_user_id, NEW.content_snapshot, v_conv FROM public.messages m WHERE m.id = NEW.target_id;
    IF v_me IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = v_conv AND cp.user_id = v_me) THEN
      RAISE EXCEPTION 'You can only report messages in your own conversations';
    END IF;
  ELSIF NEW.target_type = 'profile' THEN
    SELECT mp.id, 'Profile of ' || mp.display_name || coalesce(E'\nHeadline: ' || mp.headline, '') || coalesce(E'\nBio: ' || left(mp.bio, 1500), '')
      INTO NEW.target_user_id, NEW.content_snapshot FROM public.member_profiles mp WHERE mp.id = NEW.target_id;
  END IF;

  IF NEW.target_user_id IS NULL THEN
    RAISE EXCEPTION 'Reported content not found';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reports_before_insert ON public.reports;
CREATE TRIGGER reports_before_insert BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.trg_reports_before_insert();

-- 3h. Notifications — none of these can ever block the underlying write
CREATE OR REPLACE FUNCTION public.trg_notify_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT author_id INTO v_owner FROM public.posts WHERE id = NEW.post_id;
  IF v_owner IS NOT NULL AND v_owner <> NEW.author_id THEN
    INSERT INTO public.notifications (user_id, type, actor_id, post_id, comment_id, preview, link)
    VALUES (v_owner, 'comment', NEW.author_id, NEW.post_id, NEW.id, left(NEW.body, 140),
            'feed.html?post=' || NEW.post_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'trg_notify_comment: %', SQLERRM; RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notify_comment ON public.post_comments;
CREATE TRIGGER notify_comment AFTER INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_comment();

CREATE OR REPLACE FUNCTION public.trg_notify_reaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT author_id INTO v_owner FROM public.posts WHERE id = NEW.post_id;
  IF v_owner IS NOT NULL AND v_owner <> NEW.user_id
     AND NOT EXISTS (SELECT 1 FROM public.notifications n
                     WHERE n.user_id = v_owner AND n.type = 'reaction' AND n.actor_id = NEW.user_id
                       AND n.post_id = NEW.post_id AND n.read_at IS NULL) THEN
    INSERT INTO public.notifications (user_id, type, actor_id, post_id, preview, link)
    VALUES (v_owner, 'reaction', NEW.user_id, NEW.post_id, NEW.emoji, 'feed.html?post=' || NEW.post_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'trg_notify_reaction: %', SQLERRM; RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notify_reaction ON public.post_reactions;
CREATE TRIGGER notify_reaction AFTER INSERT ON public.post_reactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_reaction();

CREATE OR REPLACE FUNCTION public.trg_notify_announcement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_announcement THEN
    INSERT INTO public.notifications (user_id, type, actor_id, post_id, preview, link)
    SELECT mp.id, 'announcement', NEW.author_id, NEW.id, left(NEW.body, 140), 'feed.html?post=' || NEW.id
      FROM public.member_profiles mp
     WHERE mp.id <> NEW.author_id AND public.member_is_active(mp.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'trg_notify_announcement: %', SQLERRM; RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notify_announcement ON public.posts;
CREATE TRIGGER notify_announcement AFTER INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_announcement();

-- Existing-feature notifications (concierge requests, code requests, invite requests)
CREATE OR REPLACE FUNCTION public.trg_notify_code_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'approved' THEN
    INSERT INTO public.notifications (user_id, type, preview, link)
    VALUES (NEW.user_id, 'code_ready', 'Your access code is ready to share.', 'my-codes.html');
  ELSIF NEW.status = 'denied' THEN
    INSERT INTO public.notifications (user_id, type, preview, link)
    VALUES (NEW.user_id, 'code_denied', 'Your access code request was declined.', 'my-codes.html');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'trg_notify_code_request: %', SQLERRM; RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_notify_invite_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IN ('approved','sent','denied') THEN
    INSERT INTO public.notifications (user_id, type, preview, link)
    VALUES (NEW.requester_id, 'invite_update',
            CASE NEW.status WHEN 'approved' THEN 'Your invitation request was approved.'
                            WHEN 'sent'     THEN 'The invitation you requested has been sent.'
                            ELSE 'Your invitation request was declined.' END,
            'invite-request.html');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'trg_notify_invite_request: %', SQLERRM; RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_notify_request_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    INSERT INTO public.notifications (user_id, type, preview, link)
    VALUES (NEW.user_id, 'request_update',
            'Your request is now ' || translate(coalesce(NEW.status, 'updated'), '_-', '  ') || '.',
            'requests.html');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'trg_notify_request_status: %', SQLERRM; RETURN NEW;
END $$;

DO $$
BEGIN
  IF to_regclass('public.code_requests') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS notify_code_request ON public.code_requests';
    EXECUTE 'CREATE TRIGGER notify_code_request AFTER UPDATE OF status ON public.code_requests
             FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
             EXECUTE FUNCTION public.trg_notify_code_request()';
  END IF;
  IF to_regclass('public.invite_requests') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS notify_invite_request ON public.invite_requests';
    EXECUTE 'CREATE TRIGGER notify_invite_request AFTER UPDATE OF status ON public.invite_requests
             FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
             EXECUTE FUNCTION public.trg_notify_invite_request()';
  END IF;
  IF to_regclass('public.requests') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS notify_request_status ON public.requests';
    EXECUTE 'CREATE TRIGGER notify_request_status AFTER UPDATE OF status ON public.requests
             FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
             EXECUTE FUNCTION public.trg_notify_request_status()';
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════
-- 4. RPC FUNCTIONS
-- ════════════════════════════════════════════════════════════════════

-- Find or create the 1:1 conversation with another member.
-- Blocks surface as "unavailable" so a blocked member can't detect the block.
CREATE OR REPLACE FUNCTION public.start_conversation(p_other uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid(); v_conv uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_other IS NULL OR p_other = v_me THEN RAISE EXCEPTION 'invalid_recipient'; END IF;
  IF NOT public.can_message() THEN RAISE EXCEPTION 'messaging_restricted'; END IF;
  IF NOT public.member_is_active(p_other) OR public.is_blocked_between(v_me, p_other) THEN
    RAISE EXCEPTION 'recipient_unavailable';
  END IF;

  PERFORM public.ensure_member_profile(v_me);
  PERFORM public.ensure_member_profile(p_other);

  SELECT c.id INTO v_conv
    FROM public.conversations c
   WHERE NOT c.is_group
     AND EXISTS (SELECT 1 FROM public.conversation_participants a WHERE a.conversation_id = c.id AND a.user_id = v_me)
     AND EXISTS (SELECT 1 FROM public.conversation_participants b WHERE b.conversation_id = c.id AND b.user_id = p_other)
   LIMIT 1;
  IF v_conv IS NOT NULL THEN RETURN v_conv; END IF;

  INSERT INTO public.conversations (created_by) VALUES (v_me) RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (v_conv, v_me), (v_conv, p_other);
  RETURN v_conv;
END $$;

-- Inbox: one row per conversation, newest first. Runs with caller's RLS.
CREATE OR REPLACE FUNCTION public.list_my_conversations()
RETURNS TABLE (
  conversation_id uuid, last_message_at timestamptz,
  other_user_id uuid, other_display_name text, other_avatar_path text,
  last_body text, last_sender_id uuid, last_deleted boolean, unread_count int
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.last_message_at,
         o.user_id, mp.display_name, mp.avatar_path,
         lm.body, lm.sender_id, (lm.deleted_at IS NOT NULL),
         (SELECT count(*) FROM public.messages m
           WHERE m.conversation_id = c.id AND m.sender_id <> auth.uid()
             AND m.deleted_at IS NULL AND m.created_at > me.last_read_at)::int
    FROM public.conversation_participants me
    JOIN public.conversations c ON c.id = me.conversation_id
    LEFT JOIN LATERAL (SELECT cp.user_id FROM public.conversation_participants cp
                        WHERE cp.conversation_id = c.id AND cp.user_id <> auth.uid() LIMIT 1) o ON true
    LEFT JOIN public.member_profiles mp ON mp.id = o.user_id
    LEFT JOIN LATERAL (SELECT m.body, m.sender_id, m.deleted_at FROM public.messages m
                        WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) lm ON true
   WHERE me.user_id = auth.uid()
   ORDER BY c.last_message_at DESC
$$;

CREATE OR REPLACE FUNCTION public.unread_message_count()
RETURNS int LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int
    FROM public.messages m
    JOIN public.conversation_participants me
      ON me.conversation_id = m.conversation_id AND me.user_id = auth.uid()
   WHERE m.sender_id <> auth.uid() AND m.deleted_at IS NULL AND m.created_at > me.last_read_at
$$;


-- ════════════════════════════════════════════════════════════════════
-- 5. ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.member_profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_restrictions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_blocks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_reactions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_archive            ENABLE ROW LEVEL SECURITY;

-- Drop every v4 policy first so re-runs are clean
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies
            WHERE schemaname = 'public' AND policyname LIKE 'v4\_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- member_profiles — visible to all active members; inactive members disappear
CREATE POLICY v4_mp_select ON public.member_profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.is_admin())
         OR ((SELECT public.is_active_member()) AND public.member_is_active(id)));
CREATE POLICY v4_mp_insert_own ON public.member_profiles FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY v4_mp_update_own ON public.member_profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY v4_mp_admin ON public.member_profiles FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- member_restrictions — members can read their own; only admins write
CREATE POLICY v4_mr_select_own ON public.member_restrictions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY v4_mr_admin ON public.member_restrictions FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- member_blocks — private to the blocker
CREATE POLICY v4_mb_select_own ON public.member_blocks FOR SELECT TO authenticated
  USING (blocker_id = (SELECT auth.uid()));
CREATE POLICY v4_mb_insert_own ON public.member_blocks FOR INSERT TO authenticated
  WITH CHECK (blocker_id = (SELECT auth.uid()));
CREATE POLICY v4_mb_delete_own ON public.member_blocks FOR DELETE TO authenticated
  USING (blocker_id = (SELECT auth.uid()));
CREATE POLICY v4_mb_admin ON public.member_blocks FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- posts — one shared feed; blocks hide posts in both directions
CREATE POLICY v4_posts_select ON public.posts FOR SELECT TO authenticated
  USING ((SELECT public.is_admin())
         OR ((SELECT public.is_active_member())
             AND public.member_is_active(author_id)
             AND NOT public.is_blocked_between((SELECT auth.uid()), author_id)));
CREATE POLICY v4_posts_insert ON public.posts FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()) AND (SELECT public.can_post())
              AND ((NOT is_pinned AND NOT is_announcement) OR (SELECT public.is_admin())));
CREATE POLICY v4_posts_update_own ON public.posts FOR UPDATE TO authenticated
  USING (author_id = (SELECT auth.uid()))
  WITH CHECK (author_id = (SELECT auth.uid()) AND (SELECT public.can_post())
              AND ((NOT is_pinned AND NOT is_announcement) OR (SELECT public.is_admin())));
CREATE POLICY v4_posts_delete_own ON public.posts FOR DELETE TO authenticated
  USING (author_id = (SELECT auth.uid()));
CREATE POLICY v4_posts_admin ON public.posts FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- post_comments — visible only alongside a post you can see
CREATE POLICY v4_comments_select ON public.post_comments FOR SELECT TO authenticated
  USING ((SELECT public.is_admin())
         OR ((SELECT public.is_active_member())
             AND public.member_is_active(author_id)
             AND NOT public.is_blocked_between((SELECT auth.uid()), author_id)
             AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id)));
CREATE POLICY v4_comments_insert ON public.post_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()) AND (SELECT public.can_post())
              AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id));
CREATE POLICY v4_comments_update_own ON public.post_comments FOR UPDATE TO authenticated
  USING (author_id = (SELECT auth.uid())) WITH CHECK (author_id = (SELECT auth.uid()));
CREATE POLICY v4_comments_delete ON public.post_comments FOR DELETE TO authenticated
  USING (author_id = (SELECT auth.uid())
         OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.author_id = (SELECT auth.uid())));
CREATE POLICY v4_comments_admin ON public.post_comments FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- post_reactions
CREATE POLICY v4_reactions_select ON public.post_reactions FOR SELECT TO authenticated
  USING ((SELECT public.is_admin())
         OR ((SELECT public.is_active_member()) AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id)));
CREATE POLICY v4_reactions_insert ON public.post_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.is_active_member())
              AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id));
CREATE POLICY v4_reactions_delete_own ON public.post_reactions FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY v4_reactions_admin ON public.post_reactions FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- conversations / participants / messages — participants only (+ admins)
CREATE POLICY v4_conv_select ON public.conversations FOR SELECT TO authenticated
  USING (public.is_conversation_participant(id) OR (SELECT public.is_admin()));
CREATE POLICY v4_conv_admin ON public.conversations FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY v4_cp_select ON public.conversation_participants FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id) OR (SELECT public.is_admin()));
CREATE POLICY v4_cp_update_own ON public.conversation_participants FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY v4_cp_admin ON public.conversation_participants FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY v4_msg_select ON public.messages FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id) OR (SELECT public.is_admin()));
CREATE POLICY v4_msg_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = (SELECT auth.uid())
              AND public.is_conversation_participant(conversation_id)
              AND (SELECT public.can_message())
              AND NOT public.conversation_has_block(conversation_id));
CREATE POLICY v4_msg_update_own ON public.messages FOR UPDATE TO authenticated
  USING (sender_id = (SELECT auth.uid()) AND deleted_at IS NULL)
  WITH CHECK (sender_id = (SELECT auth.uid()));
CREATE POLICY v4_msg_admin ON public.messages FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- reports — members can file; only admins can read or act
CREATE POLICY v4_reports_insert ON public.reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = (SELECT auth.uid()) AND (SELECT public.is_active_member()));
CREATE POLICY v4_reports_admin ON public.reports FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- notifications — private to the recipient
CREATE POLICY v4_notif_select_own ON public.notifications FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY v4_notif_update_own ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY v4_notif_delete_own ON public.notifications FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY v4_notif_admin ON public.notifications FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- content_archive — admins only
CREATE POLICY v4_archive_admin ON public.content_archive FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));


-- ════════════════════════════════════════════════════════════════════
-- 6. GRANTS — explicit, per Supabase's Oct-2026 Data API change.
--    Column-level UPDATE grants stop members rewriting fields like
--    author_id or conversation_id even on rows they own.
-- ════════════════════════════════════════════════════════════════════
REVOKE ALL ON public.member_profiles, public.member_restrictions, public.member_blocks,
              public.posts, public.post_comments, public.post_reactions,
              public.conversations, public.conversation_participants, public.messages,
              public.reports, public.notifications, public.content_archive
  FROM anon, authenticated;

GRANT SELECT, INSERT, DELETE ON public.member_profiles TO authenticated;
GRANT UPDATE (display_name, pronouns, headline, location, bio, interests, avatar_path, last_seen_at)
  ON public.member_profiles TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_restrictions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.member_blocks TO authenticated;

GRANT SELECT, DELETE ON public.posts TO authenticated;
GRANT INSERT (author_id, body, image_path, is_announcement, is_pinned) ON public.posts TO authenticated;
GRANT UPDATE (body, image_path, is_announcement, is_pinned) ON public.posts TO authenticated;

GRANT SELECT, DELETE ON public.post_comments TO authenticated;
GRANT INSERT (post_id, author_id, body) ON public.post_comments TO authenticated;
GRANT UPDATE (body) ON public.post_comments TO authenticated;

GRANT SELECT, INSERT, DELETE ON public.post_reactions TO authenticated;

GRANT SELECT, DELETE ON public.conversations TO authenticated;
GRANT SELECT, DELETE ON public.conversation_participants TO authenticated;
GRANT UPDATE (last_read_at) ON public.conversation_participants TO authenticated;

GRANT SELECT, DELETE ON public.messages TO authenticated;
GRANT INSERT (conversation_id, sender_id, body) ON public.messages TO authenticated;
GRANT UPDATE (body, deleted_at) ON public.messages TO authenticated;

GRANT SELECT, DELETE ON public.reports TO authenticated;
GRANT INSERT (target_type, target_id, reason, details) ON public.reports TO authenticated;
GRANT UPDATE (status, admin_notes, resolved_at, resolved_by) ON public.reports TO authenticated;

GRANT SELECT, DELETE ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

GRANT SELECT, DELETE ON public.content_archive TO authenticated;

GRANT ALL ON public.member_profiles, public.member_restrictions, public.member_blocks,
             public.posts, public.post_comments, public.post_reactions,
             public.conversations, public.conversation_participants, public.messages,
             public.reports, public.notifications, public.content_archive
  TO service_role;

-- Functions: nothing callable by anon. RLS helpers + RPCs → authenticated.
-- Trigger functions → nobody (triggers run regardless of EXECUTE grants).
REVOKE EXECUTE ON FUNCTION
  public.member_is_active(uuid), public.is_active_member(), public.can_post(), public.can_message(),
  public.is_blocked_between(uuid, uuid), public.is_conversation_participant(uuid),
  public.conversation_has_block(uuid), public.ensure_member_profile(uuid),
  public.start_conversation(uuid), public.list_my_conversations(), public.unread_message_count(),
  public.trg_profiles_sync_member(), public.trg_touch_updated_at(), public.trg_posts_archive(),
  public.trg_comments_archive(), public.trg_messages_guard(), public.trg_messages_after_insert(),
  public.trg_reports_before_insert(), public.trg_notify_comment(), public.trg_notify_reaction(),
  public.trg_notify_announcement(), public.trg_notify_code_request(),
  public.trg_notify_invite_request(), public.trg_notify_request_status()
  FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION
  public.ensure_member_profile(uuid),
  public.trg_profiles_sync_member(), public.trg_touch_updated_at(), public.trg_posts_archive(),
  public.trg_comments_archive(), public.trg_messages_guard(), public.trg_messages_after_insert(),
  public.trg_reports_before_insert(), public.trg_notify_comment(), public.trg_notify_reaction(),
  public.trg_notify_announcement(), public.trg_notify_code_request(),
  public.trg_notify_invite_request(), public.trg_notify_request_status()
  FROM authenticated;

GRANT EXECUTE ON FUNCTION
  public.member_is_active(uuid), public.is_active_member(), public.can_post(), public.can_message(),
  public.is_blocked_between(uuid, uuid), public.is_conversation_participant(uuid),
  public.conversation_has_block(uuid),
  public.start_conversation(uuid), public.list_my_conversations(), public.unread_message_count()
  TO authenticated;


-- ════════════════════════════════════════════════════════════════════
-- 7. BACKFILL — public profile for every existing member
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.profiles LOOP
    PERFORM public.ensure_member_profile(r.id);
  END LOOP;
END $$;


-- ════════════════════════════════════════════════════════════════════
-- 8. STORAGE — private bucket for avatars + post images.
--    Files live under <user_id>/... ; members read via short-lived
--    signed URLs. Wrapped so a permissions hiccup reports instead of
--    aborting the migration.
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('social-media', 'social-media', false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
  ON CONFLICT (id) DO UPDATE
    SET public = false, file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Storage bucket not created automatically: %', SQLERRM;
END $$;

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS fe_social_media_read ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS fe_social_media_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS fe_social_media_update ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS fe_social_media_delete ON storage.objects';

  EXECUTE $p$CREATE POLICY fe_social_media_read ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'social-media' AND ((SELECT public.is_active_member()) OR (SELECT public.is_admin())))$p$;
  EXECUTE $p$CREATE POLICY fe_social_media_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'social-media'
                AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
                AND (SELECT public.is_active_member()))$p$;
  EXECUTE $p$CREATE POLICY fe_social_media_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'social-media'
           AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text OR (SELECT public.is_admin())))$p$;
  EXECUTE $p$CREATE POLICY fe_social_media_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'social-media'
           AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text OR (SELECT public.is_admin())))$p$;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Storage policies not created automatically: %', SQLERRM;
END $$;


-- ════════════════════════════════════════════════════════════════════
-- 9. REALTIME — live messages, notifications and new-post alerts
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE WARNING 'supabase_realtime publication not found — realtime skipped (polling fallback still works)';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['messages','notifications','posts'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Realtime not enabled automatically: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════
-- 10. VERIFICATION — this result grid is what you should see after Run.
--     Every row should read OK.
-- ════════════════════════════════════════════════════════════════════
SELECT check_name,
       CASE WHEN ok THEN 'OK' ELSE 'NEEDS ATTENTION — see PROJECT_NOTES §14' END AS result,
       detail
FROM (
  SELECT 1 AS ord, 'Community tables (12)' AS check_name,
         (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN
           ('member_profiles','member_restrictions','member_blocks','posts','post_comments','post_reactions',
            'conversations','conversation_participants','messages','reports','notifications','content_archive')) = 12 AS ok,
         'tables present' AS detail
  UNION ALL
  SELECT 2, 'Member profiles backfilled',
         (SELECT count(*) FROM public.member_profiles) >= (SELECT count(*) FROM public.profiles),
         (SELECT count(*) FROM public.member_profiles)::text || ' of ' || (SELECT count(*) FROM public.profiles)::text || ' members'
  UNION ALL
  SELECT 3, 'RLS policies',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'v4\_%') >= 40,
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'v4\_%')::text || ' policies'
  UNION ALL
  SELECT 4, 'Storage bucket social-media',
         EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'social-media' AND NOT public),
         'private bucket'
  UNION ALL
  SELECT 5, 'Storage policies',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'fe\_social\_media\_%') = 4,
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'fe\_social\_media\_%')::text || ' of 4'
  UNION ALL
  SELECT 6, 'Realtime tables',
         (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
           AND tablename IN ('messages','notifications','posts')) = 3,
         (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
           AND tablename IN ('messages','notifications','posts'))::text || ' of 3'
) checks
ORDER BY ord;

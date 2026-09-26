CREATE TYPE "public"."access_type" AS ENUM('OPEN_PARKING', 'GATED_PARKING', 'BUILDING_GARAGE');--> statement-breakpoint
CREATE TYPE "public"."connector_type" AS ENUM('TYPE2', 'TYPE1');--> statement-breakpoint
CREATE TYPE "public"."ocpp_direction" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."ocpp_message_kind" AS ENUM('CALL', 'CALLRESULT', 'CALLERROR');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('PENDING_PAYMENT', 'HOLD_EXPIRED', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'SETTLED', 'CANCELLED', 'EXPIRED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('STARTING', 'CHARGING', 'STOPPING', 'COMPLETED', 'SETTLING', 'SETTLED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."slot_status" AS ENUM('OPEN', 'HELD', 'RESERVED', 'CLOSED');--> statement-breakpoint
CREATE SEQUENCE "public"."ocpp_transaction_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_address" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius_km" double precision NOT NULL,
	"arrive_at" timestamp with time zone NOT NULL,
	"depart_at" timestamp with time zone NOT NULL,
	"requested_wh" integer NOT NULL,
	"connector_type" "connector_type" NOT NULL,
	"accepted_access_types" "access_type"[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intents_driver_address_lower" CHECK ("intents"."driver_address" = lower("intents"."driver_address")),
	CONSTRAINT "intents_window" CHECK ("intents"."arrive_at" < "intents"."depart_at")
);
--> statement-breakpoint
CREATE TABLE "meter_samples" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "meter_samples_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" uuid NOT NULL,
	"ocpp_transaction_id" integer NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"energy_wh" integer NOT NULL,
	"power_w" integer DEFAULT 0 NOT NULL,
	"raw" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_address" text NOT NULL,
	"name" text NOT NULL,
	"area_label" text NOT NULL,
	"address_line" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"access_instructions" text DEFAULT '' NOT NULL,
	"connector_type" "connector_type" NOT NULL,
	"max_power_kw" double precision NOT NULL,
	"access_type" "access_type" NOT NULL,
	"ocpp_charge_point_id" text NOT NULL,
	"ocpp_connector_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_host_address_lower" CHECK ("nodes"."host_address" = lower("nodes"."host_address")),
	CONSTRAINT "nodes_ocpp_connector_id_pos" CHECK ("nodes"."ocpp_connector_id" >= 1)
);
--> statement-breakpoint
CREATE TABLE "ocpp_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ocpp_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"charge_point_id" text NOT NULL,
	"direction" "ocpp_direction" NOT NULL,
	"kind" "ocpp_message_kind" NOT NULL,
	"message_id" text NOT NULL,
	"action" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"onchain_id" text NOT NULL,
	"intent_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"driver_address" text NOT NULL,
	"host_address" text NOT NULL,
	"status" "reservation_status" DEFAULT 'PENDING_PAYMENT' NOT NULL,
	"requested_wh" integer NOT NULL,
	"price_per_kwh_wei" numeric(78, 0) NOT NULL,
	"deposit_wei" numeric(78, 0) NOT NULL,
	"window_starts_at" timestamp with time zone NOT NULL,
	"window_ends_at" timestamp with time zone NOT NULL,
	"hold_expires_at" timestamp with time zone NOT NULL,
	"quote_signature" text,
	"reserve_tx_hash" text,
	"start_tx_hash" text,
	"settle_tx_hash" text,
	"cancel_tx_hash" text,
	"settled_delivered_wh" integer,
	"billable_wh" integer,
	"host_amount_wei" numeric(78, 0),
	"refund_wei" numeric(78, 0),
	"session_hash" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_driver_lower" CHECK ("reservations"."driver_address" = lower("reservations"."driver_address")),
	CONSTRAINT "reservations_host_lower" CHECK ("reservations"."host_address" = lower("reservations"."host_address"))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"status" "session_status" DEFAULT 'STARTING' NOT NULL,
	"charge_point_id" text NOT NULL,
	"connector_id" integer NOT NULL,
	"ocpp_id_tag" text NOT NULL,
	"ocpp_transaction_id" integer,
	"requested_wh" integer NOT NULL,
	"meter_start_wh" integer,
	"latest_meter_wh" integer,
	"meter_stop_wh" integer,
	"delivered_wh" integer DEFAULT 0 NOT NULL,
	"power_w" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"stop_reason" text,
	"proof_canonical_json" text,
	"session_hash" text,
	"start_tx_hash" text,
	"settle_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"slot_ref" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"max_energy_wh" integer NOT NULL,
	"price_per_kwh_wei" numeric(78, 0) NOT NULL,
	"status" "slot_status" DEFAULT 'OPEN' NOT NULL,
	"held_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slots_window" CHECK ("slots"."starts_at" < "slots"."ends_at"),
	CONSTRAINT "slots_max_energy_pos" CHECK ("slots"."max_energy_wh" > 0),
	CONSTRAINT "slots_price_pos" CHECK ("slots"."price_per_kwh_wei" > 0)
);
--> statement-breakpoint
ALTER TABLE "meter_samples" ADD CONSTRAINT "meter_samples_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intents_driver_address_idx" ON "intents" USING btree ("driver_address");--> statement-breakpoint
CREATE INDEX "meter_samples_session_sampled_idx" ON "meter_samples" USING btree ("session_id","sampled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "nodes_ocpp_charge_point_id_uq" ON "nodes" USING btree ("ocpp_charge_point_id");--> statement-breakpoint
CREATE INDEX "nodes_host_address_idx" ON "nodes" USING btree ("host_address");--> statement-breakpoint
CREATE INDEX "ocpp_messages_cp_created_idx" ON "ocpp_messages" USING btree ("charge_point_id","created_at");--> statement-breakpoint
CREATE INDEX "ocpp_messages_message_id_idx" ON "ocpp_messages" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_onchain_id_uq" ON "reservations" USING btree ("onchain_id");--> statement-breakpoint
CREATE INDEX "reservations_driver_address_idx" ON "reservations" USING btree ("driver_address");--> statement-breakpoint
CREATE INDEX "reservations_host_address_idx" ON "reservations" USING btree ("host_address");--> statement-breakpoint
CREATE INDEX "reservations_slot_id_idx" ON "reservations" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "reservations_status_idx" ON "reservations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_reservation_id_uq" ON "sessions" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_ocpp_transaction_id_uq" ON "sessions" USING btree ("ocpp_transaction_id");--> statement-breakpoint
CREATE INDEX "sessions_charge_point_idx" ON "sessions" USING btree ("charge_point_id","connector_id");--> statement-breakpoint
CREATE INDEX "sessions_ocpp_id_tag_idx" ON "sessions" USING btree ("ocpp_id_tag");--> statement-breakpoint
CREATE UNIQUE INDEX "slots_slot_ref_uq" ON "slots" USING btree ("slot_ref");--> statement-breakpoint
CREATE INDEX "slots_node_starts_idx" ON "slots" USING btree ("node_id","starts_at");--> statement-breakpoint
CREATE INDEX "slots_status_idx" ON "slots" USING btree ("status");
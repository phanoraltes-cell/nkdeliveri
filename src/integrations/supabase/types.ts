export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      addresses: {
        Row: {
          address_line: string;
          city: string;
          created_at: string;
          id: string;
          is_default: boolean;
          label: string | null;
          lat: number | null;
          lng: number | null;
          notes: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          address_line: string;
          city?: string;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          label?: string | null;
          lat?: number | null;
          lng?: number | null;
          notes?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          address_line?: string;
          city?: string;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          label?: string | null;
          lat?: number | null;
          lng?: number | null;
          notes?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          action: string;
          created_at: string;
          id: number;
          metadata: Json;
          role: string | null;
          user_id: string | null;
        };
        Insert: {
          action: string;
          created_at?: string;
          id?: number;
          metadata?: Json;
          role?: string | null;
          user_id?: string | null;
        };
        Update: {
          action?: string;
          created_at?: string;
          id?: number;
          metadata?: Json;
          role?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      backfill_runs: {
        Row: {
          completed_at: string | null;
          created_at: string;
          error_details: Json;
          id: string;
          orders_already_migrated: number;
          orders_failed: number;
          orders_migrated: number;
          orders_scanned: number;
          orders_skipped: number;
          run_by: string;
          started_at: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          error_details?: Json;
          id?: string;
          orders_already_migrated?: number;
          orders_failed?: number;
          orders_migrated?: number;
          orders_scanned?: number;
          orders_skipped?: number;
          run_by: string;
          started_at?: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          error_details?: Json;
          id?: string;
          orders_already_migrated?: number;
          orders_failed?: number;
          orders_migrated?: number;
          orders_scanned?: number;
          orders_skipped?: number;
          run_by?: string;
          started_at?: string;
        };
        Relationships: [];
      };
      commission_ledger: {
        Row: {
          commission_amount: number;
          commission_rate: number | null;
          created_at: string;
          created_by: string | null;
          driver_id: string | null;
          entry_type: Database["public"]["Enums"]["commission_entry_type"];
          gross_amount: number;
          id: string;
          net_amount: number;
          notes: string | null;
          order_id: string | null;
          period_month: string | null;
          restaurant_id: string | null;
        };
        Insert: {
          commission_amount?: number;
          commission_rate?: number | null;
          created_at?: string;
          created_by?: string | null;
          driver_id?: string | null;
          entry_type: Database["public"]["Enums"]["commission_entry_type"];
          gross_amount?: number;
          id?: string;
          net_amount: number;
          notes?: string | null;
          order_id?: string | null;
          period_month?: string | null;
          restaurant_id?: string | null;
        };
        Update: {
          commission_amount?: number;
          commission_rate?: number | null;
          created_at?: string;
          created_by?: string | null;
          driver_id?: string | null;
          entry_type?: Database["public"]["Enums"]["commission_entry_type"];
          gross_amount?: number;
          id?: string;
          net_amount?: number;
          notes?: string | null;
          order_id?: string | null;
          period_month?: string | null;
          restaurant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "commission_ledger_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commission_ledger_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commission_ledger_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      deliveries: {
        Row: {
          assigned_at: string;
          created_at: string;
          delivered_at: string | null;
          driver_heading: number | null;
          driver_id: string | null;
          driver_lat: number | null;
          driver_lng: number | null;
          driver_notes: string | null;
          fee: number;
          id: string;
          location_updated_at: string | null;
          order_id: string;
          picked_up_at: string | null;
          status: Database["public"]["Enums"]["delivery_status"];
          updated_at: string;
        };
        Insert: {
          assigned_at?: string;
          created_at?: string;
          delivered_at?: string | null;
          driver_heading?: number | null;
          driver_id?: string | null;
          driver_lat?: number | null;
          driver_lng?: number | null;
          driver_notes?: string | null;
          fee?: number;
          id?: string;
          location_updated_at?: string | null;
          order_id: string;
          picked_up_at?: string | null;
          status?: Database["public"]["Enums"]["delivery_status"];
          updated_at?: string;
        };
        Update: {
          assigned_at?: string;
          created_at?: string;
          delivered_at?: string | null;
          driver_heading?: number | null;
          driver_id?: string | null;
          driver_lat?: number | null;
          driver_lng?: number | null;
          driver_notes?: string | null;
          fee?: number;
          id?: string;
          location_updated_at?: string | null;
          order_id?: string;
          picked_up_at?: string | null;
          status?: Database["public"]["Enums"]["delivery_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deliveries_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deliveries_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      dispute_messages: {
        Row: {
          author_id: string;
          author_role: Database["public"]["Enums"]["dispute_author_role"];
          created_at: string;
          dispute_id: string;
          id: string;
          message: string;
        };
        Insert: {
          author_id: string;
          author_role: Database["public"]["Enums"]["dispute_author_role"];
          created_at?: string;
          dispute_id: string;
          id?: string;
          message: string;
        };
        Update: {
          author_id?: string;
          author_role?: Database["public"]["Enums"]["dispute_author_role"];
          created_at?: string;
          dispute_id?: string;
          id?: string;
          message?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dispute_messages_dispute_id_fkey";
            columns: ["dispute_id"];
            isOneToOne: false;
            referencedRelation: "disputes";
            referencedColumns: ["id"];
          },
        ];
      };
      disputes: {
        Row: {
          category: string;
          created_at: string;
          customer_id: string;
          driver_id: string | null;
          id: string;
          order_id: string;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          restaurant_id: string;
          status: Database["public"]["Enums"]["dispute_status"];
          updated_at: string;
        };
        Insert: {
          category: string;
          created_at?: string;
          customer_id: string;
          driver_id?: string | null;
          id?: string;
          order_id: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          restaurant_id: string;
          status?: Database["public"]["Enums"]["dispute_status"];
          updated_at?: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          customer_id?: string;
          driver_id?: string | null;
          id?: string;
          order_id?: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          restaurant_id?: string;
          status?: Database["public"]["Enums"]["dispute_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "disputes_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "disputes_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "disputes_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
        ];
      };
      drivers: {
        Row: {
          address: string | null;
          commission_rate: number;
          created_at: string;
          current_lat: number | null;
          current_lng: number | null;
          first_name: string | null;
          id: string;
          id_doc_url: string | null;
          last_name: string | null;
          license_doc_url: string | null;
          license_plate: string | null;
          // Anticipates migration 20260712120000_add_driver_payout_account_names.sql
          // (not yet applied) — re-run `supabase gen types` after applying it.
          moncash_account_name: string | null;
          moncash_number: string | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          payout_frequency: string;
          phone: string | null;
          status: Database["public"]["Enums"]["driver_status"];
          updated_at: string;
          user_id: string;
          vehicle_photo_url: string | null;
          vehicle_type: string | null;
        };
        Insert: {
          address?: string | null;
          commission_rate?: number;
          created_at?: string;
          current_lat?: number | null;
          current_lng?: number | null;
          first_name?: string | null;
          id?: string;
          id_doc_url?: string | null;
          last_name?: string | null;
          license_doc_url?: string | null;
          license_plate?: string | null;
          moncash_account_name?: string | null;
          moncash_number?: string | null;
          natcash_account_name?: string | null;
          natcash_number?: string | null;
          payout_frequency?: string;
          phone?: string | null;
          status?: Database["public"]["Enums"]["driver_status"];
          updated_at?: string;
          user_id: string;
          vehicle_photo_url?: string | null;
          vehicle_type?: string | null;
        };
        Update: {
          address?: string | null;
          commission_rate?: number;
          created_at?: string;
          current_lat?: number | null;
          current_lng?: number | null;
          first_name?: string | null;
          id?: string;
          id_doc_url?: string | null;
          last_name?: string | null;
          license_doc_url?: string | null;
          license_plate?: string | null;
          moncash_account_name?: string | null;
          moncash_number?: string | null;
          natcash_account_name?: string | null;
          natcash_number?: string | null;
          payout_frequency?: string;
          phone?: string | null;
          status?: Database["public"]["Enums"]["driver_status"];
          updated_at?: string;
          user_id?: string;
          vehicle_photo_url?: string | null;
          vehicle_type?: string | null;
        };
        Relationships: [];
      };
      favorites: {
        Row: {
          created_at: string;
          id: string;
          restaurant_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          restaurant_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          restaurant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "favorites_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      menu_categories: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          restaurant_id: string;
          sort_order: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          restaurant_id: string;
          sort_order?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          restaurant_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      newsletter_subscribers: {
        Row: {
          email: string;
          id: string;
          source: string;
          subscribed_at: string;
          unsubscribed_at: string | null;
        };
        Insert: {
          email: string;
          id?: string;
          source?: string;
          subscribed_at?: string;
          unsubscribed_at?: string | null;
        };
        Update: {
          email?: string;
          id?: string;
          source?: string;
          subscribed_at?: string;
          unsubscribed_at?: string | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          data: Json;
          id: string;
          read_at: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          data?: Json;
          id?: string;
          read_at?: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          data?: Json;
          id?: string;
          read_at?: string | null;
          title?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          created_at: string;
          id: string;
          line_total: number;
          notes: string | null;
          order_id: string;
          product_id: string | null;
          product_name: string;
          quantity: number;
          unit_price: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          line_total: number;
          notes?: string | null;
          order_id: string;
          product_id?: string | null;
          product_name: string;
          quantity: number;
          unit_price: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          line_total?: number;
          notes?: string | null;
          order_id?: string;
          product_id?: string | null;
          product_name?: string;
          quantity?: number;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          address_id: string | null;
          contact_phone: string | null;
          created_at: string;
          currency: string;
          customer_id: string;
          delivery_address: string;
          delivery_fee: number;
          delivery_lat: number | null;
          delivery_lng: number | null;
          delivery_notes: string | null;
          id: string;
          order_number: string;
          restaurant_id: string;
          service_fee: number;
          status: Database["public"]["Enums"]["order_status"];
          status_history: Json;
          subtotal: number;
          total: number;
          updated_at: string;
        };
        Insert: {
          address_id?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          currency?: string;
          customer_id: string;
          delivery_address: string;
          delivery_fee?: number;
          delivery_lat?: number | null;
          delivery_lng?: number | null;
          delivery_notes?: string | null;
          id?: string;
          order_number?: string;
          restaurant_id: string;
          service_fee?: number;
          status?: Database["public"]["Enums"]["order_status"];
          status_history?: Json;
          subtotal?: number;
          total?: number;
          updated_at?: string;
        };
        Update: {
          address_id?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          currency?: string;
          customer_id?: string;
          delivery_address?: string;
          delivery_fee?: number;
          delivery_lat?: number | null;
          delivery_lng?: number | null;
          delivery_notes?: string | null;
          id?: string;
          order_number?: string;
          restaurant_id?: string;
          service_fee?: number;
          status?: Database["public"]["Enums"]["order_status"];
          status_history?: Json;
          subtotal?: number;
          total?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_address_id_fkey";
            columns: ["address_id"];
            isOneToOne: false;
            referencedRelation: "addresses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_proofs: {
        Row: {
          created_at: string;
          file_url: string;
          id: string;
          notes: string | null;
          payment_id: string;
          sender_phone: string | null;
          transaction_ref: string | null;
          uploaded_by: string;
        };
        Insert: {
          created_at?: string;
          file_url: string;
          id?: string;
          notes?: string | null;
          payment_id: string;
          sender_phone?: string | null;
          transaction_ref?: string | null;
          uploaded_by: string;
        };
        Update: {
          created_at?: string;
          file_url?: string;
          id?: string;
          notes?: string | null;
          payment_id?: string;
          sender_phone?: string | null;
          transaction_ref?: string | null;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_proofs_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          created_at: string;
          currency: string;
          id: string;
          method: Database["public"]["Enums"]["payment_method"];
          order_id: string;
          receiver_account_name: string | null;
          receiver_number: string | null;
          receiver_restaurant_id: string | null;
          receiver_type: string;
          review_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sender_name: string | null;
          sender_phone: string | null;
          status: Database["public"]["Enums"]["payment_status"];
          stripe_payment_intent_id: string | null;
          stripe_session_id: string | null;
          transaction_ref: string | null;
          updated_at: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          currency?: string;
          id?: string;
          method: Database["public"]["Enums"]["payment_method"];
          order_id: string;
          receiver_account_name?: string | null;
          receiver_number?: string | null;
          receiver_restaurant_id?: string | null;
          receiver_type?: string;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sender_name?: string | null;
          sender_phone?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          stripe_payment_intent_id?: string | null;
          stripe_session_id?: string | null;
          transaction_ref?: string | null;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          order_id?: string;
          receiver_account_name?: string | null;
          receiver_number?: string | null;
          receiver_restaurant_id?: string | null;
          receiver_type?: string;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sender_name?: string | null;
          sender_phone?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          stripe_payment_intent_id?: string | null;
          stripe_session_id?: string | null;
          transaction_ref?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_receiver_restaurant_id_fkey";
            columns: ["receiver_restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_methods: {
        Row: {
          code: string;
          created_at: string;
          is_active: boolean;
          label: string;
          sort_order: number;
        };
        Insert: {
          code: string;
          created_at?: string;
          is_active?: boolean;
          label: string;
          sort_order?: number;
        };
        Update: {
          code?: string;
          created_at?: string;
          is_active?: boolean;
          label?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      payout_commissions: {
        Row: {
          commission_ledger_id: string;
          covered_amount: number;
          created_at: string;
          payout_id: string;
        };
        Insert: {
          commission_ledger_id: string;
          covered_amount?: number;
          created_at?: string;
          payout_id: string;
        };
        Update: {
          commission_ledger_id?: string;
          covered_amount?: number;
          created_at?: string;
          payout_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payout_commissions_commission_ledger_id_fkey";
            columns: ["commission_ledger_id"];
            isOneToOne: false;
            referencedRelation: "commission_ledger";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payout_commissions_payout_id_fkey";
            columns: ["payout_id"];
            isOneToOne: false;
            referencedRelation: "payouts";
            referencedColumns: ["id"];
          },
        ];
      };
      payouts: {
        Row: {
          admin_notes: string | null;
          amount: number;
          confirmed_at: string | null;
          created_at: string;
          disputed_at: string | null;
          dispute_reason: string | null;
          driver_id: string | null;
          id: string;
          method: string;
          paid_by: string;
          proof_url: string | null;
          receiver_account_name: string | null;
          receiver_number: string;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          restaurant_id: string | null;
          status: Database["public"]["Enums"]["payout_status"];
          status_history: Json;
          transaction_reference: string;
          updated_at: string;
          wallet_id: string;
        };
        Insert: {
          admin_notes?: string | null;
          amount: number;
          confirmed_at?: string | null;
          created_at?: string;
          disputed_at?: string | null;
          dispute_reason?: string | null;
          driver_id?: string | null;
          id?: string;
          method: string;
          paid_by: string;
          proof_url?: string | null;
          receiver_account_name?: string | null;
          receiver_number: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          restaurant_id?: string | null;
          status?: Database["public"]["Enums"]["payout_status"];
          status_history?: Json;
          transaction_reference: string;
          updated_at?: string;
          wallet_id: string;
        };
        Update: {
          admin_notes?: string | null;
          amount?: number;
          confirmed_at?: string | null;
          created_at?: string;
          disputed_at?: string | null;
          dispute_reason?: string | null;
          driver_id?: string | null;
          id?: string;
          method?: string;
          paid_by?: string;
          proof_url?: string | null;
          receiver_account_name?: string | null;
          receiver_number?: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          restaurant_id?: string | null;
          status?: Database["public"]["Enums"]["payout_status"];
          status_history?: Json;
          transaction_reference?: string;
          updated_at?: string;
          wallet_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payouts_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_method_fkey";
            columns: ["method"];
            isOneToOne: false;
            referencedRelation: "payment_methods";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "payouts_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_payout_settings: {
        Row: {
          id: boolean;
          moncash_account_name: string | null;
          moncash_number: string | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          moncash_account_name?: string | null;
          moncash_number?: string | null;
          natcash_account_name?: string | null;
          natcash_number?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          moncash_account_name?: string | null;
          moncash_number?: string | null;
          natcash_account_name?: string | null;
          natcash_number?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          archived_at: string | null;
          available: boolean;
          category_id: string | null;
          created_at: string;
          description: string | null;
          dish_type: string | null;
          id: string;
          image_url: string | null;
          name: string;
          popular: boolean;
          price: number;
          restaurant_id: string;
          sort_order: number;
          stock_quantity: number | null;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          available?: boolean;
          category_id?: string | null;
          created_at?: string;
          description?: string | null;
          dish_type?: string | null;
          id?: string;
          image_url?: string | null;
          name: string;
          popular?: boolean;
          price: number;
          restaurant_id: string;
          sort_order?: number;
          stock_quantity?: number | null;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          available?: boolean;
          category_id?: string | null;
          created_at?: string;
          description?: string | null;
          dish_type?: string | null;
          id?: string;
          image_url?: string | null;
          name?: string;
          popular?: boolean;
          price?: number;
          restaurant_id?: string;
          sort_order?: number;
          stock_quantity?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "menu_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          address: string | null;
          avatar_url: string | null;
          created_at: string;
          first_name: string | null;
          id: string;
          last_name: string | null;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          first_name?: string | null;
          id: string;
          last_name?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      promotions: {
        Row: {
          active: boolean;
          code: string | null;
          created_at: string;
          description: string | null;
          discount_type: string;
          discount_value: number;
          ends_at: string | null;
          id: string;
          restaurant_id: string;
          starts_at: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          code?: string | null;
          created_at?: string;
          description?: string | null;
          discount_type: string;
          discount_value: number;
          ends_at?: string | null;
          id?: string;
          restaurant_id: string;
          starts_at?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          code?: string | null;
          created_at?: string;
          description?: string | null;
          discount_type?: string;
          discount_value?: number;
          ends_at?: string | null;
          id?: string;
          restaurant_id?: string;
          starts_at?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "promotions_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_used_at: string;
          p256dh: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_used_at?: string;
          p256dh: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_used_at?: string;
          p256dh?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      refunds: {
        Row: {
          admin_notes: string | null;
          amount: number;
          completed_at: string | null;
          created_at: string;
          customer_id: string;
          id: string;
          order_id: string;
          payment_id: string;
          reason: string;
          restaurant_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["refund_status"];
          status_history: Json;
          updated_at: string;
        };
        Insert: {
          admin_notes?: string | null;
          amount: number;
          completed_at?: string | null;
          created_at?: string;
          customer_id: string;
          id?: string;
          order_id: string;
          payment_id: string;
          reason: string;
          restaurant_id: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["refund_status"];
          status_history?: Json;
          updated_at?: string;
        };
        Update: {
          admin_notes?: string | null;
          amount?: number;
          completed_at?: string | null;
          created_at?: string;
          customer_id?: string;
          id?: string;
          order_id?: string;
          payment_id?: string;
          reason?: string;
          restaurant_id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["refund_status"];
          status_history?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "refunds_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      restaurant_employees: {
        Row: {
          created_at: string;
          id: string;
          restaurant_id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          restaurant_id: string;
          role?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          restaurant_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "restaurant_employees_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      restaurant_payout_details: {
        Row: {
          commission_rate: number | null;
          commission_type: string | null;
          created_at: string;
          moncash_account_name: string | null;
          moncash_number: string | null;
          monthly_commission_amount: number | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          restaurant_id: string;
          updated_at: string;
        };
        Insert: {
          commission_rate?: number | null;
          commission_type?: string | null;
          created_at?: string;
          moncash_account_name?: string | null;
          moncash_number?: string | null;
          monthly_commission_amount?: number | null;
          natcash_account_name?: string | null;
          natcash_number?: string | null;
          restaurant_id: string;
          updated_at?: string;
        };
        Update: {
          commission_rate?: number | null;
          commission_type?: string | null;
          created_at?: string;
          moncash_account_name?: string | null;
          moncash_number?: string | null;
          monthly_commission_amount?: number | null;
          natcash_account_name?: string | null;
          natcash_number?: string | null;
          restaurant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "restaurant_payout_details_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: true;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      restaurants: {
        Row: {
          address: string | null;
          avg_prep_time: number;
          cover_url: string | null;
          created_at: string;
          cuisine: string | null;
          delivery_fee: number;
          description: string | null;
          id: string;
          lat: number | null;
          latitude: number | null;
          lng: number | null;
          logo_url: string | null;
          longitude: number | null;
          min_order: number;
          name: string;
          opening_hours: Json | null;
          owner_id: string | null;
          phone: string | null;
          rating: number | null;
          slug: string;
          status: Database["public"]["Enums"]["restaurant_status"];
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          avg_prep_time?: number;
          cover_url?: string | null;
          created_at?: string;
          cuisine?: string | null;
          delivery_fee?: number;
          description?: string | null;
          id?: string;
          lat?: number | null;
          latitude?: number | null;
          lng?: number | null;
          logo_url?: string | null;
          longitude?: number | null;
          min_order?: number;
          name: string;
          opening_hours?: Json | null;
          owner_id?: string | null;
          phone?: string | null;
          rating?: number | null;
          slug: string;
          status?: Database["public"]["Enums"]["restaurant_status"];
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          avg_prep_time?: number;
          cover_url?: string | null;
          created_at?: string;
          cuisine?: string | null;
          delivery_fee?: number;
          description?: string | null;
          id?: string;
          lat?: number | null;
          latitude?: number | null;
          lng?: number | null;
          logo_url?: string | null;
          longitude?: number | null;
          min_order?: number;
          name?: string;
          opening_hours?: Json | null;
          owner_id?: string | null;
          phone?: string | null;
          rating?: number | null;
          slug?: string;
          status?: Database["public"]["Enums"]["restaurant_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      reviews: {
        Row: {
          comment: string | null;
          created_at: string;
          customer_id: string;
          driver_id: string | null;
          driver_rating: number | null;
          id: string;
          order_id: string;
          restaurant_id: string | null;
          restaurant_rating: number | null;
        };
        Insert: {
          comment?: string | null;
          created_at?: string;
          customer_id: string;
          driver_id?: string | null;
          driver_rating?: number | null;
          id?: string;
          order_id: string;
          restaurant_id?: string | null;
          restaurant_rating?: number | null;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          customer_id?: string;
          driver_id?: string | null;
          driver_rating?: number | null;
          id?: string;
          order_id?: string;
          restaurant_id?: string | null;
          restaurant_rating?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      wallet_transactions: {
        Row: {
          available_delta: number;
          commission_ledger_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          lifetime_delta: number;
          note: string | null;
          paid_delta: number;
          payout_id: string | null;
          pending_delta: number;
          type: string;
          wallet_id: string;
        };
        Insert: {
          available_delta?: number;
          commission_ledger_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          lifetime_delta?: number;
          note?: string | null;
          paid_delta?: number;
          payout_id?: string | null;
          pending_delta?: number;
          type: string;
          wallet_id: string;
        };
        Update: {
          available_delta?: number;
          commission_ledger_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          lifetime_delta?: number;
          note?: string | null;
          paid_delta?: number;
          payout_id?: string | null;
          pending_delta?: number;
          type?: string;
          wallet_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_commission_ledger_id_fkey";
            columns: ["commission_ledger_id"];
            isOneToOne: false;
            referencedRelation: "commission_ledger";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wallet_transactions_payout_id_fkey";
            columns: ["payout_id"];
            isOneToOne: false;
            referencedRelation: "payouts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey";
            columns: ["wallet_id"];
            isOneToOne: false;
            referencedRelation: "wallets";
            referencedColumns: ["id"];
          },
        ];
      };
      wallets: {
        Row: {
          available_balance: number;
          created_at: string;
          driver_id: string | null;
          id: string;
          lifetime_earnings: number;
          paid_balance: number;
          pending_balance: number;
          restaurant_id: string | null;
          updated_at: string;
        };
        Insert: {
          available_balance?: number;
          created_at?: string;
          driver_id?: string | null;
          id?: string;
          lifetime_earnings?: number;
          paid_balance?: number;
          pending_balance?: number;
          restaurant_id?: string | null;
          updated_at?: string;
        };
        Update: {
          available_balance?: number;
          created_at?: string;
          driver_id?: string | null;
          id?: string;
          lifetime_earnings?: number;
          paid_balance?: number;
          pending_balance?: number;
          restaurant_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wallets_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: true;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wallets_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: true;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_dispute_message_secure: {
        Args: { _dispute_id: string; _message: string };
        Returns: {
          author_id: string;
          author_role: Database["public"]["Enums"]["dispute_author_role"];
          created_at: string;
          dispute_id: string;
          id: string;
          message: string;
        };
        SetofOptions: {
          from: "*";
          to: "dispute_messages";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      add_restaurant_employee_secure: {
        Args: { _email: string; _restaurant_id: string; _role?: string };
        Returns: {
          created_at: string;
          id: string;
          restaurant_id: string;
          role: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "restaurant_employees";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      add_user_role_secure: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: undefined;
      };
      charge_restaurant_monthly_fee_secure: {
        Args: { _period?: string; _restaurant_id: string };
        Returns: {
          commission_amount: number;
          commission_rate: number | null;
          created_at: string;
          created_by: string | null;
          driver_id: string | null;
          entry_type: Database["public"]["Enums"]["commission_entry_type"];
          gross_amount: number;
          id: string;
          net_amount: number;
          notes: string | null;
          order_id: string | null;
          period_month: string | null;
          restaurant_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "commission_ledger";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      check_auth_rate_limit_secure: {
        Args: {
          _action: string;
          _email: string;
          _max_hits: number;
          _window_seconds: number;
        };
        Returns: boolean;
      };
      check_rate_limit_secure: {
        Args: {
          _action: string;
          _actor_override?: string | null;
          _max_hits: number;
          _window_seconds: number;
        };
        Returns: boolean;
      };
      claim_delivery_secure: {
        Args: { _order_id: string };
        Returns: {
          assigned_at: string;
          created_at: string;
          delivered_at: string | null;
          driver_heading: number | null;
          driver_id: string | null;
          driver_lat: number | null;
          driver_lng: number | null;
          driver_notes: string | null;
          fee: number;
          id: string;
          location_updated_at: string | null;
          order_id: string;
          picked_up_at: string | null;
          status: Database["public"]["Enums"]["delivery_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "deliveries";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      complete_refund_secure: {
        Args: { _refund_id: string };
        Returns: {
          admin_notes: string | null;
          amount: number;
          completed_at: string | null;
          created_at: string;
          customer_id: string;
          id: string;
          order_id: string;
          payment_id: string;
          reason: string;
          restaurant_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["refund_status"];
          status_history: Json;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "refunds";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      confirm_payout_secure: {
        Args: { _payout_id: string };
        Returns: {
          admin_notes: string | null;
          amount: number;
          confirmed_at: string | null;
          created_at: string;
          disputed_at: string | null;
          dispute_reason: string | null;
          driver_id: string | null;
          id: string;
          method: string;
          paid_by: string;
          proof_url: string | null;
          receiver_account_name: string | null;
          receiver_number: string;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          restaurant_id: string | null;
          status: Database["public"]["Enums"]["payout_status"];
          status_history: Json;
          transaction_reference: string;
          updated_at: string;
          wallet_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "payouts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_menu_category_secure: {
        Args: { _name: string; _restaurant_id: string; _sort_order?: number };
        Returns: {
          created_at: string;
          id: string;
          name: string;
          restaurant_id: string;
          sort_order: number;
        };
        SetofOptions: {
          from: "*";
          to: "menu_categories";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_order_secure: {
        Args: {
          _contact_phone: string;
          _delivery_address: string;
          _delivery_notes: string;
          _items: Json;
          _method: Database["public"]["Enums"]["payment_method"];
          _restaurant_id: string;
        };
        Returns: string;
      };
      create_product_secure: {
        Args: {
          _category_id: string;
          _description: string;
          _dish_type: string;
          _image_url: string;
          _name: string;
          _price: number;
          _restaurant_id: string;
          _stock_quantity?: number;
        };
        Returns: {
          archived_at: string | null;
          available: boolean;
          category_id: string | null;
          created_at: string;
          description: string | null;
          dish_type: string | null;
          id: string;
          image_url: string | null;
          name: string;
          popular: boolean;
          price: number;
          restaurant_id: string;
          sort_order: number;
          stock_quantity: number | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "products";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_promotion_secure: {
        Args: {
          _code: string;
          _description: string;
          _discount_type: string;
          _discount_value: number;
          _ends_at: string;
          _restaurant_id: string;
          _starts_at: string;
          _title: string;
        };
        Returns: {
          active: boolean;
          code: string | null;
          created_at: string;
          description: string | null;
          discount_type: string;
          discount_value: number;
          ends_at: string | null;
          id: string;
          restaurant_id: string;
          starts_at: string | null;
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "promotions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      delete_menu_category_secure: {
        Args: { _category_id: string };
        Returns: undefined;
      };
      delete_product_secure: {
        Args: { _product_id: string };
        Returns: undefined;
      };
      delete_promotion_secure: {
        Args: { _promotion_id: string };
        Returns: undefined;
      };
      dispute_payout_secure: {
        Args: { _payout_id: string; _reason: string };
        Returns: {
          admin_notes: string | null;
          amount: number;
          confirmed_at: string | null;
          created_at: string;
          disputed_at: string | null;
          dispute_reason: string | null;
          driver_id: string | null;
          id: string;
          method: string;
          paid_by: string;
          proof_url: string | null;
          receiver_account_name: string | null;
          receiver_number: string;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          restaurant_id: string | null;
          status: Database["public"]["Enums"]["payout_status"];
          status_history: Json;
          transaction_reference: string;
          updated_at: string;
          wallet_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "payouts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      execute_commission_backfill_secure: {
        Args: { _order_ids?: string[] };
        Returns: {
          detail: string | null;
          order_id: string;
          order_number: string;
          outcome: string;
        }[];
      };
      get_admin_payout_kpis: {
        Args: never;
        Returns: {
          avg_payment_delay_hours: number | null;
          avg_payout_amount: number | null;
          commissions_this_month: number;
          dispute_count: number;
          drivers_waiting_count: number;
          largest_unpaid_driver_amount: number | null;
          largest_unpaid_driver_name: string | null;
          largest_unpaid_restaurant_amount: number | null;
          largest_unpaid_restaurant_name: string | null;
          owed_drivers: number;
          owed_restaurants: number;
          payout_count: number;
          restaurants_waiting_count: number;
          total_paid: number;
          total_pending: number;
        }[];
      };
      get_all_users_admin: {
        Args: {
          _limit?: number;
          _offset?: number;
          _role?: Database["public"]["Enums"]["app_role"] | null;
          _search?: string;
        };
        Returns: {
          banned_until: string;
          created_at: string;
          email: string;
          first_name: string;
          id: string;
          last_name: string;
          phone: string;
          roles: string[];
          total_count: number;
        }[];
      };
      get_commission_monthly_series: {
        Args: { _from: string; _to: string };
        Returns: { month: string; total_commission: number }[];
      };
      get_customers_admin: {
        Args: { _limit?: number; _offset?: number; _search?: string };
        Returns: {
          address: string;
          created_at: string;
          email: string;
          first_name: string;
          id: string;
          last_name: string;
          phone: string;
          total_count: number;
          total_orders: number;
          total_spent: number;
        }[];
      };
      get_driver_commissions_secure: {
        Args: {
          _driver_id: string;
          _from?: string;
          _limit?: number;
          _offset?: number;
          _search?: string;
          _sort?: string;
          _status?: string;
          _to?: string;
        };
        Returns: {
          commission_amount: number;
          commission_rate: number | null;
          commission_status: string;
          contact_phone: string | null;
          covered_amount: number;
          created_at: string;
          entry_type: string;
          gross_amount: number;
          id: string;
          net_amount: number;
          order_date: string | null;
          order_id: string | null;
          order_number: string | null;
          payout_id: string | null;
          total_count: number;
        }[];
      };
      get_driver_earnings_summary: {
        Args: { _driver_id: string; _from: string; _to: string };
        Returns: {
          total_deliveries: number;
          total_earnings: number;
          week_earnings: number;
          week_start: string;
        }[];
      };
      get_driver_wallets_admin: {
        Args: {
          _limit?: number;
          _offset?: number;
          _search?: string;
          _sort?: string;
          _status?: string;
        };
        Returns: {
          available_balance: number;
          computed_status: string;
          driver_id: string;
          last_payment_date: string | null;
          lifetime_earnings: number;
          moncash_account_name: string | null;
          moncash_number: string | null;
          name: string;
          natcash_account_name: string | null;
          natcash_number: string | null;
          paid_balance: number;
          pending_balance: number;
          total_count: number;
          total_orders: number;
        }[];
      };
      get_drivers_admin: {
        Args: {
          _limit?: number;
          _offset?: number;
          _search?: string;
          _sort?: string;
          _status?: string;
        };
        Returns: {
          available_balance: number;
          avg_delivery_minutes: number | null;
          avg_rating: number | null;
          cancelled_count: number;
          created_at: string;
          delivered_count: number;
          email: string;
          first_name: string | null;
          id: string;
          last_name: string | null;
          last_payment_date: string | null;
          license_plate: string | null;
          moncash_number: string | null;
          natcash_number: string | null;
          phone: string | null;
          status: Database["public"]["Enums"]["driver_status"];
          success_rate: number | null;
          total_count: number;
          total_deliveries: number;
          vehicle_type: string | null;
        }[];
      };
      get_historical_backfill_preview_secure: {
        Args: {
          _driver_id?: string;
          _from?: string;
          _limit?: number;
          _offset?: number;
          _restaurant_id?: string;
          _search?: string;
          _sort?: string;
          _to?: string;
        };
        Returns: {
          delivery_fee: number;
          driver_commission_amount: number | null;
          driver_id: string | null;
          driver_name: string | null;
          migration_status: string;
          order_date: string;
          order_id: string;
          order_number: string;
          platform_commission_amount: number;
          restaurant_commission_amount: number | null;
          restaurant_id: string;
          restaurant_name: string | null;
          subtotal: number;
          total_count: number;
        }[];
      };
      get_historical_backfill_summary_secure: {
        Args: never;
        Returns: {
          driver_count: number;
          estimated_driver_earnings: number;
          estimated_platform_commission: number;
          estimated_restaurant_earnings: number;
          restaurant_count: number;
          total_orders: number;
        }[];
      };
      get_payouts_monthly_series: {
        Args: { _from: string; _to: string };
        Returns: { month: string; total_paid: number }[];
      };
      get_platform_payout_public: {
        Args: never;
        Returns: {
          moncash_account_name: string;
          moncash_number: string;
          natcash_account_name: string;
          natcash_number: string;
        }[];
      };
      get_primary_role: { Args: { _user_id: string }; Returns: string };
      get_restaurant_commissions_secure: {
        Args: {
          _from?: string;
          _limit?: number;
          _offset?: number;
          _restaurant_id: string;
          _search?: string;
          _sort?: string;
          _status?: string;
          _to?: string;
        };
        Returns: {
          commission_amount: number;
          commission_rate: number | null;
          commission_status: string;
          contact_phone: string | null;
          covered_amount: number;
          created_at: string;
          entry_type: string;
          gross_amount: number;
          id: string;
          net_amount: number;
          order_date: string | null;
          order_id: string | null;
          order_number: string | null;
          payout_id: string | null;
          total_count: number;
        }[];
      };
      get_restaurant_payout_public: {
        Args: { _restaurant_id: string };
        Returns: {
          moncash_account_name: string;
          moncash_number: string;
          natcash_account_name: string;
          natcash_number: string;
          restaurant_id: string;
        }[];
      };
      get_restaurant_revenue_summary: {
        Args: { _from: string; _restaurant_id: string; _to: string };
        Returns: {
          cancelled_orders: number;
          commission_amount: number;
          commission_rate: number;
          delivered_orders: number;
          gross_revenue: number;
          net_payout: number;
          paid_amount: number;
          pending_amount: number;
          total_orders: number;
        }[];
      };
      get_restaurant_wallets_admin: {
        Args: {
          _limit?: number;
          _offset?: number;
          _search?: string;
          _sort?: string;
          _status?: string;
        };
        Returns: {
          available_balance: number;
          computed_status: string;
          last_payment_date: string | null;
          lifetime_earnings: number;
          moncash_account_name: string | null;
          moncash_number: string | null;
          name: string;
          natcash_account_name: string | null;
          natcash_number: string | null;
          paid_balance: number;
          pending_balance: number;
          restaurant_id: string;
          total_count: number;
          total_orders: number;
        }[];
      };
      get_restaurants_admin: {
        Args: { _limit?: number; _offset?: number };
        Returns: {
          commission_rate: number;
          commission_type: string;
          created_at: string;
          cuisine: string;
          id: string;
          monthly_commission_amount: number;
          name: string;
          status: Database["public"]["Enums"]["restaurant_status"];
          total_count: number;
        }[];
      };
      get_top_drivers_by_commission: {
        Args: { _from: string; _limit?: number; _to: string };
        Returns: { driver_id: string; name: string; total_commission: number }[];
      };
      get_top_restaurants_by_commission: {
        Args: { _from: string; _limit?: number; _to: string };
        Returns: { name: string; restaurant_id: string; total_commission: number }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      initiate_payout_secure: {
        Args: {
          _amount?: number;
          _driver_id?: string;
          _method?: string;
          _notes?: string;
          _proof_url?: string;
          _restaurant_id?: string;
          _transaction_reference?: string;
        };
        Returns: {
          admin_notes: string | null;
          amount: number;
          confirmed_at: string | null;
          created_at: string;
          disputed_at: string | null;
          dispute_reason: string | null;
          driver_id: string | null;
          id: string;
          method: string;
          paid_by: string;
          proof_url: string | null;
          receiver_account_name: string | null;
          receiver_number: string;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          restaurant_id: string | null;
          status: Database["public"]["Enums"]["payout_status"];
          status_history: Json;
          transaction_reference: string;
          updated_at: string;
          wallet_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "payouts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      list_restaurant_employees_secure: {
        Args: { _restaurant_id: string };
        Returns: {
          created_at: string;
          email: string;
          first_name: string;
          id: string;
          last_name: string;
          role: string;
          user_id: string;
        }[];
      };
      open_dispute_secure: {
        Args: { _category: string; _description: string; _order_id: string };
        Returns: {
          category: string;
          created_at: string;
          customer_id: string;
          driver_id: string | null;
          id: string;
          order_id: string;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          restaurant_id: string;
          status: Database["public"]["Enums"]["dispute_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "disputes";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      recompute_wallet_secure: {
        Args: { _driver_id?: string; _restaurant_id?: string };
        Returns: {
          available_balance: number;
          created_at: string;
          driver_id: string | null;
          id: string;
          lifetime_earnings: number;
          paid_balance: number;
          pending_balance: number;
          restaurant_id: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "wallets";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      remove_restaurant_employee_secure: {
        Args: { _id: string };
        Returns: undefined;
      };
      remove_user_role_secure: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: undefined;
      };
      request_refund_secure: {
        Args: { _order_id: string; _reason: string };
        Returns: {
          admin_notes: string | null;
          amount: number;
          completed_at: string | null;
          created_at: string;
          customer_id: string;
          id: string;
          order_id: string;
          payment_id: string;
          reason: string;
          restaurant_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["refund_status"];
          status_history: Json;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "refunds";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      resolve_dispute_secure: {
        Args: { _dispute_id: string; _resolution: string };
        Returns: {
          category: string;
          created_at: string;
          customer_id: string;
          driver_id: string | null;
          id: string;
          order_id: string;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          restaurant_id: string;
          status: Database["public"]["Enums"]["dispute_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "disputes";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      resolve_payout_dispute_secure: {
        Args: {
          _admin_notes?: string;
          _payout_id: string;
          _resolution: string;
        };
        Returns: {
          admin_notes: string | null;
          amount: number;
          confirmed_at: string | null;
          created_at: string;
          disputed_at: string | null;
          dispute_reason: string | null;
          driver_id: string | null;
          id: string;
          method: string;
          paid_by: string;
          proof_url: string | null;
          receiver_account_name: string | null;
          receiver_number: string;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          restaurant_id: string | null;
          status: Database["public"]["Enums"]["payout_status"];
          status_history: Json;
          transaction_reference: string;
          updated_at: string;
          wallet_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "payouts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      review_manual_payment_secure: {
        Args: {
          _decision: Database["public"]["Enums"]["payment_status"];
          _note?: string | null;
          _payment_id: string;
        };
        Returns: {
          amount: number;
          created_at: string;
          currency: string;
          id: string;
          method: Database["public"]["Enums"]["payment_method"];
          order_id: string;
          receiver_account_name: string | null;
          receiver_number: string | null;
          receiver_restaurant_id: string | null;
          receiver_type: string;
          review_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sender_name: string | null;
          sender_phone: string | null;
          status: Database["public"]["Enums"]["payment_status"];
          stripe_payment_intent_id: string | null;
          stripe_session_id: string | null;
          transaction_ref: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "payments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      review_refund_secure: {
        Args: {
          _admin_notes: string;
          _decision: Database["public"]["Enums"]["refund_status"];
          _refund_id: string;
        };
        Returns: {
          admin_notes: string | null;
          amount: number;
          completed_at: string | null;
          created_at: string;
          customer_id: string;
          id: string;
          order_id: string;
          payment_id: string;
          reason: string;
          restaurant_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["refund_status"];
          status_history: Json;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "refunds";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      submit_payment_proof_secure: {
        Args: {
          _file_url: string;
          _notes: string;
          _payment_id: string;
          _sender_phone: string;
          _transaction_ref: string;
        };
        Returns: {
          amount: number;
          created_at: string;
          currency: string;
          id: string;
          method: Database["public"]["Enums"]["payment_method"];
          order_id: string;
          receiver_account_name: string | null;
          receiver_number: string | null;
          receiver_restaurant_id: string | null;
          receiver_type: string;
          review_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sender_name: string | null;
          sender_phone: string | null;
          status: Database["public"]["Enums"]["payment_status"];
          stripe_payment_intent_id: string | null;
          stripe_session_id: string | null;
          transaction_ref: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "payments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_driver_payout_secure: {
        Args: {
          _driver_id: string;
          _moncash_account_name: string;
          _moncash_number: string;
          _natcash_account_name: string;
          _natcash_number: string;
          _payout_frequency: string;
        };
        Returns: {
          address: string | null;
          commission_rate: number;
          created_at: string;
          current_lat: number | null;
          current_lng: number | null;
          first_name: string | null;
          id: string;
          id_doc_url: string | null;
          last_name: string | null;
          license_doc_url: string | null;
          license_plate: string | null;
          moncash_account_name: string | null;
          moncash_number: string | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          payout_frequency: string;
          phone: string | null;
          status: Database["public"]["Enums"]["driver_status"];
          updated_at: string;
          user_id: string;
          vehicle_photo_url: string | null;
          vehicle_type: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "drivers";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_driver_status_secure: {
        Args: {
          _driver_id: string;
          _reason?: string;
          _status: Database["public"]["Enums"]["driver_status"];
        };
        Returns: {
          address: string | null;
          commission_rate: number;
          created_at: string;
          current_lat: number | null;
          current_lng: number | null;
          first_name: string | null;
          id: string;
          id_doc_url: string | null;
          last_name: string | null;
          license_doc_url: string | null;
          license_plate: string | null;
          moncash_account_name: string | null;
          moncash_number: string | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          payout_frequency: string;
          phone: string | null;
          status: Database["public"]["Enums"]["driver_status"];
          updated_at: string;
          user_id: string;
          vehicle_photo_url: string | null;
          vehicle_type: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "drivers";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_menu_category_secure: {
        Args: { _category_id: string; _name: string; _sort_order: number };
        Returns: {
          created_at: string;
          id: string;
          name: string;
          restaurant_id: string;
          sort_order: number;
        };
        SetofOptions: {
          from: "*";
          to: "menu_categories";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_order_status_secure: {
        Args: {
          _new_status: Database["public"]["Enums"]["order_status"];
          _order_id: string;
        };
        Returns: {
          address_id: string | null;
          contact_phone: string | null;
          created_at: string;
          currency: string;
          customer_id: string;
          delivery_address: string;
          delivery_fee: number;
          delivery_lat: number | null;
          delivery_lng: number | null;
          delivery_notes: string | null;
          id: string;
          order_number: string;
          restaurant_id: string;
          service_fee: number;
          status: Database["public"]["Enums"]["order_status"];
          status_history: Json;
          subtotal: number;
          total: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_platform_payout_settings_secure: {
        Args: {
          _moncash_account_name: string;
          _moncash_number: string;
          _natcash_account_name: string;
          _natcash_number: string;
        };
        Returns: undefined;
      };
      update_product_secure: {
        Args: {
          _available: boolean;
          _category_id: string;
          _description: string;
          _dish_type: string;
          _image_url: string;
          _name: string;
          _price: number;
          _product_id: string;
          _stock_quantity?: number;
        };
        Returns: {
          archived_at: string | null;
          available: boolean;
          category_id: string | null;
          created_at: string;
          description: string | null;
          dish_type: string | null;
          id: string;
          image_url: string | null;
          name: string;
          popular: boolean;
          price: number;
          restaurant_id: string;
          sort_order: number;
          stock_quantity: number | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "products";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_promotion_secure: {
        Args: {
          _active: boolean;
          _code: string;
          _description: string;
          _discount_type: string;
          _discount_value: number;
          _ends_at: string;
          _promotion_id: string;
          _starts_at: string;
          _title: string;
        };
        Returns: {
          active: boolean;
          code: string | null;
          created_at: string;
          description: string | null;
          discount_type: string;
          discount_value: number;
          ends_at: string | null;
          id: string;
          restaurant_id: string;
          starts_at: string | null;
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "promotions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_restaurant_commission_secure: {
        Args: {
          _commission_rate: number;
          _commission_type: string;
          _monthly_commission_amount: number;
          _restaurant_id: string;
        };
        Returns: {
          commission_rate: number | null;
          commission_type: string | null;
          created_at: string;
          moncash_account_name: string | null;
          moncash_number: string | null;
          monthly_commission_amount: number | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          restaurant_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "restaurant_payout_details";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_restaurant_hours_secure: {
        Args: { _opening_hours: Json; _restaurant_id: string };
        Returns: {
          address: string | null;
          avg_prep_time: number;
          cover_url: string | null;
          created_at: string;
          cuisine: string | null;
          delivery_fee: number;
          description: string | null;
          id: string;
          lat: number | null;
          latitude: number | null;
          lng: number | null;
          logo_url: string | null;
          longitude: number | null;
          min_order: number;
          name: string;
          opening_hours: Json | null;
          owner_id: string | null;
          phone: string | null;
          rating: number | null;
          slug: string;
          status: Database["public"]["Enums"]["restaurant_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "restaurants";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_restaurant_payout_secure: {
        Args: {
          _moncash_account_name: string;
          _moncash_number: string;
          _natcash_account_name: string;
          _natcash_number: string;
          _restaurant_id: string;
        };
        Returns: {
          commission_rate: number | null;
          commission_type: string | null;
          created_at: string;
          moncash_account_name: string | null;
          moncash_number: string | null;
          monthly_commission_amount: number | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          restaurant_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "restaurant_payout_details";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_restaurant_profile_secure: {
        Args: {
          _address: string;
          _cover_url: string;
          _cuisine: string;
          _description: string;
          _logo_url: string;
          _name: string;
          _phone: string;
          _restaurant_id: string;
        };
        Returns: {
          address: string | null;
          avg_prep_time: number;
          cover_url: string | null;
          created_at: string;
          cuisine: string | null;
          delivery_fee: number;
          description: string | null;
          id: string;
          lat: number | null;
          latitude: number | null;
          lng: number | null;
          logo_url: string | null;
          longitude: number | null;
          min_order: number;
          name: string;
          opening_hours: Json | null;
          owner_id: string | null;
          phone: string | null;
          rating: number | null;
          slug: string;
          status: Database["public"]["Enums"]["restaurant_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "restaurants";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_restaurant_employee_role_secure: {
        Args: { _id: string; _role: string };
        Returns: {
          created_at: string;
          id: string;
          restaurant_id: string;
          role: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "restaurant_employees";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_restaurant_status_secure: {
        Args: {
          _restaurant_id: string;
          _status: Database["public"]["Enums"]["restaurant_status"];
        };
        Returns: {
          address: string | null;
          avg_prep_time: number;
          cover_url: string | null;
          created_at: string;
          cuisine: string | null;
          delivery_fee: number;
          description: string | null;
          id: string;
          lat: number | null;
          latitude: number | null;
          lng: number | null;
          logo_url: string | null;
          longitude: number | null;
          min_order: number;
          name: string;
          opening_hours: Json | null;
          owner_id: string | null;
          phone: string | null;
          rating: number | null;
          slug: string;
          status: Database["public"]["Enums"]["restaurant_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "restaurants";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      app_role:
        "customer" | "restaurant_owner" | "restaurant_staff" | "driver" | "admin" | "super_admin";
      commission_entry_type: "order_commission" | "monthly_fee" | "reversal";
      delivery_status:
        | "assigned"
        | "en_route_pickup"
        | "picked_up"
        | "en_route_dropoff"
        | "delivered"
        | "cancelled";
      dispute_author_role: "customer" | "restaurant" | "driver" | "admin";
      dispute_status: "open" | "resolved";
      driver_status: "pending" | "approved" | "suspended" | "rejected" | "offline" | "online";
      order_status:
        | "pending"
        | "confirmed"
        | "preparing"
        | "ready"
        | "assigned"
        | "picked_up"
        | "delivered"
        | "cancelled"
        | "refunded";
      payment_method: "stripe" | "moncash" | "natcash" | "kach";
      payment_status:
        "pending" | "awaiting_proof" | "under_review" | "paid" | "failed" | "refunded";
      payout_status: "paid" | "confirmed" | "disputed" | "resolved";
      refund_status: "requested" | "approved" | "rejected" | "completed";
      restaurant_status: "pending" | "approved" | "suspended" | "rejected";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "customer",
        "restaurant_owner",
        "restaurant_staff",
        "driver",
        "admin",
        "super_admin",
      ],
      commission_entry_type: ["order_commission", "monthly_fee", "reversal"],
      delivery_status: [
        "assigned",
        "en_route_pickup",
        "picked_up",
        "en_route_dropoff",
        "delivered",
        "cancelled",
      ],
      dispute_author_role: ["customer", "restaurant", "driver", "admin"],
      dispute_status: ["open", "resolved"],
      driver_status: ["pending", "approved", "suspended", "rejected", "offline", "online"],
      order_status: [
        "pending",
        "confirmed",
        "preparing",
        "ready",
        "assigned",
        "picked_up",
        "delivered",
        "cancelled",
        "refunded",
      ],
      payment_method: ["stripe", "moncash", "natcash", "kach"],
      payment_status: ["pending", "awaiting_proof", "under_review", "paid", "failed", "refunded"],
      payout_status: ["paid", "confirmed", "disputed", "resolved"],
      refund_status: ["requested", "approved", "rejected", "completed"],
      restaurant_status: ["pending", "approved", "suspended", "rejected"],
    },
  },
} as const;

require "supply"
require "supply/options"
require "supply/uploader"

module Fastlane
  module Actions
    class UploadToPlayStoreReviewAction < Action
      class ReviewClient < Supply::Client
        def commit_current_edit!
          ensure_active_edit!
          call_google_api do
            client.commit_edit(
              current_package_name,
              current_edit.id,
              changes_not_sent_for_review: false,
              changes_in_review_behavior: "ERROR_IF_IN_REVIEW"
            )
          end
          self.current_edit = nil
          self.current_package_name = nil
        end
      end

      class ReviewUploader < Supply::Uploader
        private

        def client
          @client ||= ReviewClient.make_from_config
        end
      end

      def self.run(params)
        Supply.config = params
        ReviewUploader.new.perform_upload
      end

      def self.available_options = Supply::Options.available_options
      def self.is_supported?(platform) = platform == :android
      def self.description = "Upload Google Play assets and submit without cancelling an active review"
      def self.authors = ["Supaterm"]
    end
  end
end

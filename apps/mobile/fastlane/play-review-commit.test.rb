require "fastlane"
require "ostruct"
require_relative "actions/upload_to_play_store_review"

class GoogleCommitFixture
  attr_reader :options
  attr_accessor :reject

  def commit_edit(package, edit, **options)
    @options = options
    raise "review is active" if reject
  end
end

client = Fastlane::Actions::UploadToPlayStoreReviewAction::ReviewClient.allocate
client.client = GoogleCommitFixture.new
client.current_package_name = "com.supaterm.mobile"
client.current_edit = OpenStruct.new(id: "edit")
client.commit_current_edit!
unless client.client.options == {changes_not_sent_for_review: false, changes_in_review_behavior: "ERROR_IF_IN_REVIEW"}
  raise "Google commit does not protect existing reviews"
end
raise "Committed edit was not cleared" unless client.current_edit.nil?

client.current_package_name = "com.supaterm.mobile"
client.current_edit = OpenStruct.new(id: "edit")
client.client.reject = true
begin
  client.commit_current_edit!
  raise "Active review error was swallowed"
rescue RuntimeError => error
  raise unless error.message == "review is active"
end
raise "Failed commit was treated as successful" unless client.current_edit.id == "edit"
puts "Google Play commit guard passed with the pinned Fastlane client."

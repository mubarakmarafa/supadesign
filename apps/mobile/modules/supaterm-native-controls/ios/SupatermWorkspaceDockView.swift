import ExpoModulesCore
import UIKit

final class SupatermWorkspaceDockView: ExpoView, UITabBarDelegate {
  let onTabSelected = EventDispatcher()
  let onCompose = EventDispatcher()
  let onFilterAction = EventDispatcher()
  let onHeightChange = EventDispatcher()
  private var lastHeight: CGFloat = 0
  private let buttonSize: CGFloat = 56

  private let tabBar = UITabBar()
  private let filterButton = UIButton(type: .system)
  private let composeButton = UIButton(type: .system)
  private let threadItem = UITabBarItem(
    title: "Threads", image: UIImage(systemName: "text.bubble"),
    selectedImage: UIImage(systemName: "text.bubble.fill")
  )
  private let pullItem = UITabBarItem(title: "Pulls", image: nil, selectedImage: nil)

  var selectedTab = "threads" {
    didSet { tabBar.selectedItem = selectedTab == "pullRequests" ? pullItem : threadItem }
  }
  var showTabs = true {
    didSet { tabBar.isHidden = !showTabs; setNeedsLayout() }
  }
  var filterCustomized = false {
    didSet { updateFilterImage() }
  }
  var filterLabel = "Filter threads" {
    didSet { filterButton.accessibilityLabel = filterLabel }
  }
  var filterTitle = "" { didSet { updateMenu() } }
  var filterActions: [[String: Any]] = [] { didSet { updateMenu() } }
  var appearance = "light" {
    didSet { overrideUserInterfaceStyle = appearance == "dark" ? .dark : .light }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    tabBar.delegate = self
    tabBar.itemPositioning = .fill
    if let resources = Bundle(for: Self.self).url(forResource: "SupatermNativeControls", withExtension: "bundle"),
      let bundle = Bundle(url: resources) {
      pullItem.image = UIImage(named: "pull-request", in: bundle, compatibleWith: nil)?.withRenderingMode(.alwaysTemplate)
    }
    tabBar.setItems([threadItem, pullItem], animated: false)
    tabBar.selectedItem = threadItem
    threadItem.accessibilityLabel = "Threads"
    pullItem.accessibilityLabel = "Pull requests"

    configureButton(filterButton, image: "line.3.horizontal.decrease.circle", label: "Filter threads")
    configureButton(composeButton, image: "square.and.pencil", label: "New chat")
    filterButton.showsMenuAsPrimaryAction = true
    composeButton.addAction(UIAction { [weak self] _ in self?.onCompose([:]) }, for: .primaryActionTriggered)
    addSubview(filterButton)
    addSubview(tabBar)
    addSubview(composeButton)
    registerForTraitChanges([UITraitHorizontalSizeClass.self, UITraitVerticalSizeClass.self, UITraitPreferredContentSizeCategory.self]) { (view: SupatermWorkspaceDockView, _: UITraitCollection) in
      view.setNeedsLayout()
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard window != nil, bounds.width > 0 else { return }
    let start = buttonSize + 8
    let width = max(0, bounds.width - start * 2)
    let tabHeight = showTabs ? tabBar.sizeThatFits(CGSize(width: width, height: bounds.height)).height : 0
    tabBar.frame = CGRect(x: start, y: 0, width: width, height: tabHeight)
    tabBar.layoutIfNeeded()
    let contentFrame = tabContentFrame(tabBar)
    let contentCenter = contentFrame.isNull ? tabHeight / 2 : contentFrame.midY
    let centerY = max(buttonSize / 2, contentCenter)
    tabBar.frame.origin.y = centerY - contentCenter
    let buttonY = centerY - buttonSize / 2
    filterButton.frame = CGRect(x: 0, y: buttonY, width: buttonSize, height: buttonSize)
    composeButton.frame = CGRect(x: bounds.width - buttonSize, y: buttonY, width: buttonSize, height: buttonSize)
    let height = max(tabBar.frame.maxY, max(filterButton.frame.maxY, composeButton.frame.maxY))
    if lastHeight != height {
      lastHeight = height
      onHeightChange(["height": height])
    }
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    setNeedsLayout()
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    onTabSelected(["tab": item === pullItem ? "pullRequests" : "threads"])
  }

  private func tabContentFrame(_ view: UIView) -> CGRect {
    guard !view.isHidden, view.alpha > 0 else { return .null }
    if view is UIControl { return view.convert(view.bounds, to: tabBar) }
    return view.subviews.reduce(.null) { $0.union(tabContentFrame($1)) }
  }

  private func configureButton(_ button: UIButton, image: String, label: String) {
    var configuration: UIButton.Configuration
    if #available(iOS 26.0, *) {
      configuration = .glass()
    } else {
      configuration = .tinted()
    }
    configuration.cornerStyle = .capsule
    configuration.image = UIImage(systemName: image)
    configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 20)
    button.configuration = configuration
    button.tintColor = .label
    button.accessibilityLabel = label
  }

  private func updateFilterImage() {
    filterButton.configuration?.image = UIImage(systemName:
      filterCustomized ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"
    )
  }

  private func updateMenu() {
    filterButton.menu = UIMenu(title: filterTitle, children: filterActions.compactMap(menuElement))
  }

  private func menuElement(_ item: [String: Any]) -> UIMenuElement? {
    guard let title = item["title"] as? String else { return nil }
    if let children = item["subactions"] as? [[String: Any]] {
      return UIMenu(title: title, children: children.compactMap(menuElement))
    }
    guard let id = item["id"] as? String else { return nil }
    let flags = item["attributes"] as? [String: Any] ?? [:]
    var attributes: UIMenuElement.Attributes = []
    if flags["disabled"] as? Bool == true { attributes.insert(.disabled) }
    if flags["destructive"] as? Bool == true { attributes.insert(.destructive) }
    return UIAction(title: title, attributes: attributes,
                    state: item["state"] as? String == "on" ? .on : .off) { [weak self] _ in
      self?.onFilterAction(["event": id])
    }
  }
}

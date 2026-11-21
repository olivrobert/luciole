<?php

declare(strict_types=1);

namespace Publisher\Domain\Model;

use Catalog\Domain\Model\Book;
use Catalog\Domain\Model\Genre;
use Common\Domain\Model\IdentityTrait;
use Common\Domain\Model\Phone;
use Common\Domain\Model\SoftDeleteableTrait;
use Common\Domain\Model\TimestampableTrait;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Gedmo\Mapping\Annotation as Gedmo;
use Identity\Domain\Model\Administrator;
use Publisher\Domain\Enum\AccountStatus;
use Publisher\Domain\Enum\CatalogSize;
use Publisher\Domain\Enum\PublicationFormat;
use Publisher\Domain\Exception\IncompleteProfileException;
use Publisher\Domain\Model\Embeddable\Address;
use Publisher\Domain\Model\Embeddable\Distributor;
use SharedKernel\Domain\Model\Country;
use SharedKernel\Domain\Model\Language;
use SharedKernel\Domain\Model\Region;

#[ORM\Entity]
#[ORM\Table(name: 'publisher')]
#[ORM\UniqueConstraint(name: 'uniq_publisher_siret', columns: ['siret'])]
#[Gedmo\SoftDeleteable(fieldName: 'deletedAt', timeAware: false, hardDelete: false)]
class Publisher implements \Stringable
{
    use IdentityTrait;
    use SoftDeleteableTrait;
    use TimestampableTrait;

    public const int SIRET_LENGTH = 14;

    /** @var list<PublicationFormat> */
    public const DIGITAL_FORMATS = [
        PublicationFormat::Epub,
        PublicationFormat::Pdf,
        PublicationFormat::Audiobook,
    ];

    #[ORM\Column(length: 20, enumType: AccountStatus::class)]
    public private(set) AccountStatus $accountStatus;

    #[ORM\Column(nullable: true)]
    public private(set) ?\DateTimeImmutable $processingDate = null;

    #[ORM\ManyToOne(targetEntity: Administrator::class)]
    #[ORM\JoinColumn(nullable: true)]
    public private(set) ?Administrator $processedBy = null;

    #[ORM\Column(length: 255)]
    public private(set) string $companyName;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $tradeName = null;

    #[ORM\Column(length: 14)]
    public private(set) string $siret;

    #[ORM\Column(length: 50, nullable: true)]
    public private(set) ?string $vatNumber = null;

    #[ORM\Column(length: 20, nullable: true)]
    public private(set) ?string $isbnPrefix = null;

    #[ORM\Embedded(class: Address::class, columnPrefix: 'headquarters_')]
    public private(set) Address $headquartersAddress;

    #[ORM\Embedded(class: Address::class, columnPrefix: 'billing_')]
    public private(set) Address $billingAddress;

    #[ORM\ManyToOne(targetEntity: Country::class)]
    #[ORM\JoinColumn(nullable: false)]
    public private(set) Country $country;

    #[ORM\ManyToOne(inversedBy: 'publishers', targetEntity: Region::class)]
    #[ORM\JoinColumn(nullable: true)]
    public private(set) ?Region $region = null;

    #[ORM\Column(type: 'phone', length: 20)]
    public private(set) Phone $phone;

    #[ORM\Column(length: 255)]
    public private(set) string $contactEmail;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $website = null;

    #[ORM\Embedded(class: Distributor::class, columnPrefix: 'distributor_')]
    public private(set) Distributor $distributor;

    #[ORM\Column(enumType: CatalogSize::class)]
    public private(set) CatalogSize $catalogSize;

    #[ORM\Column(nullable: true)]
    public private(set) ?int $foundingYear = null;

    #[ORM\Column]
    public private(set) bool $publishesYouth = false;

    #[ORM\Column]
    public private(set) bool $publishesDigital = false;

    #[ORM\Column]
    public private(set) bool $acceptsDigitalLegalDeposit = false;

    /** @var PublicationFormat[] */
    #[ORM\Column(enumType: PublicationFormat::class)]
    public private(set) array $formats = [];

    #[ORM\Column(type: 'text', nullable: true)]
    public private(set) ?string $presentation = null;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $logoPath = null;

    #[ORM\Column(type: 'text', nullable: true)]
    public private(set) ?string $rejectionComment = null;

    /** @var Collection<int, Genre> */
    #[ORM\ManyToMany(targetEntity: Genre::class)]
    #[ORM\JoinTable(name: 'publisher_genre')]
    public private(set) Collection $genres;

    /** @var Collection<int, Language> */
    #[ORM\ManyToMany(targetEntity: Language::class)]
    #[ORM\JoinTable(name: 'publisher_language')]
    public private(set) Collection $languages;

    /** @var Collection<int, Book> */
    #[ORM\OneToMany(targetEntity: Book::class, mappedBy: 'publisher')]
    public private(set) Collection $books;

    /** @var Collection<int, Contact> */
    #[ORM\OneToMany(targetEntity: Contact::class, mappedBy: 'publisher', cascade: ['persist'], orphanRemoval: true)]
    public private(set) Collection $contacts;

    public function __construct(
        string $companyName,
        string $siret,
        Address $headquartersAddress,
        Country $country,
        string $phone,
        string $contactEmail,
        CatalogSize $catalogSize,
    ) {
        $this->companyName = $companyName;
        $this->siret = $siret;
        $this->headquartersAddress = $headquartersAddress;
        $this->billingAddress = $headquartersAddress;
        $this->country = $country;
        $this->phone = Phone::fromString($phone);
        $this->contactEmail = $contactEmail;
        $this->catalogSize = $catalogSize;
        $this->distributor = Distributor::none();
        $this->accountStatus = AccountStatus::Pending;
        $this->genres = new ArrayCollection();
        $this->languages = new ArrayCollection();
        $this->books = new ArrayCollection();
        $this->contacts = new ArrayCollection();
    }

    private function isProfileComplete(): bool
    {
        return null !== $this->presentation
            && !$this->genres->isEmpty()
            && !$this->languages->isEmpty()
            && !$this->contacts->isEmpty();
    }

    public function approve(Administrator $administrator): void
    {
        if (AccountStatus::Pending !== $this->accountStatus) {
            throw new \LogicException('Only a pending publisher can be approved.');
        }

        if (!$this->isProfileComplete()) {
            throw new IncompleteProfileException($this->siret);
        }

        $this->accountStatus = AccountStatus::Approved;
        $this->processingDate = new \DateTimeImmutable();
        $this->processedBy = $administrator;
        $this->rejectionComment = null;
    }

    public function reject(?Administrator $administrator = null, ?string $comment = null): void
    {
        if (AccountStatus::Pending !== $this->accountStatus) {
            throw new \LogicException('Only a pending publisher can be rejected.');
        }

        $this->accountStatus = AccountStatus::Rejected;
        $this->processingDate = new \DateTimeImmutable();
        $this->processedBy = $administrator;
        $this->rejectionComment = $comment;
    }

    public function disable(): void
    {
        if (AccountStatus::Approved !== $this->accountStatus) {
            throw new \LogicException('Only an approved publisher can be disabled.');
        }

        $this->accountStatus = AccountStatus::Disabled;
    }

    public function reactivate(): void
    {
        if (AccountStatus::Disabled !== $this->accountStatus) {
            throw new \LogicException('Only a disabled publisher can be reactivated.');
        }

        $this->accountStatus = AccountStatus::Approved;
    }

    public function resubmit(): void
    {
        if (AccountStatus::Rejected !== $this->accountStatus) {
            throw new \LogicException('Only a rejected publisher can resubmit its profile.');
        }

        $this->accountStatus = AccountStatus::Pending;
        $this->processingDate = null;
        $this->processedBy = null;
    }

    public function isPending(): bool
    {
        return AccountStatus::Pending === $this->accountStatus;
    }

    public function isApproved(): bool
    {
        return AccountStatus::Approved === $this->accountStatus;
    }

    public function isDisabled(): bool
    {
        return AccountStatus::Disabled === $this->accountStatus;
    }

    public function updateIdentity(string $companyName, ?string $tradeName, ?string $vatNumber, ?string $isbnPrefix): void
    {
        $this->companyName = $companyName;
        $this->tradeName = $tradeName;
        $this->vatNumber = $vatNumber;
        $this->isbnPrefix = $isbnPrefix;
    }

    public function updateAddresses(Address $headquarters, ?Address $billing, Country $country, ?Region $region): void
    {
        $this->headquartersAddress = $headquarters;
        $this->billingAddress = $billing ?? $headquarters;
        $this->country = $country;
        $this->region = $region;
    }

    public function updateContact(string $phone, string $contactEmail, ?string $website): void
    {
        $this->phone = Phone::fromString($phone);
        $this->contactEmail = $contactEmail;
        $this->website = $website;
    }

    public function updateDistributor(Distributor $distributor): void
    {
        $this->distributor = $distributor;
    }

    /**
     * @param list<PublicationFormat> $formats
     */
    public function updateEditorialProfile(
        CatalogSize $catalogSize,
        ?int $foundingYear,
        bool $publishesYouth,
        array $formats,
        ?string $presentation,
    ): void {
        $this->catalogSize = $catalogSize;
        $this->foundingYear = $foundingYear;
        $this->publishesYouth = $publishesYouth;
        $this->formats = $formats;
        $this->publishesDigital = [] !== array_intersect(
            array_map(static fn (PublicationFormat $f): string => $f->value, $formats),
            array_map(static fn (PublicationFormat $f): string => $f->value, self::DIGITAL_FORMATS),
        );
        $this->presentation = $presentation;
    }

    public function acceptDigitalLegalDeposit(): void
    {
        if (!$this->publishesDigital) {
            throw new \LogicException('Digital legal deposit requires a digital catalog.');
        }

        $this->acceptsDigitalLegalDeposit = true;
    }

    public function withdrawDigitalLegalDeposit(): void
    {
        $this->acceptsDigitalLegalDeposit = false;
    }

    /**
     * @param list<Genre> $genres
     */
    public function updateGenres(array $genres): void
    {
        $this->genres->clear();
        foreach ($genres as $genre) {
            $this->genres->add($genre);
        }
    }

    /**
     * @param list<Language> $languages
     */
    public function updateLanguages(array $languages): void
    {
        $this->languages->clear();
        foreach ($languages as $language) {
            $this->languages->add($language);
        }
    }

    public function addContact(Contact $contact): void
    {
        if (!$this->contacts->contains($contact)) {
            $this->contacts->add($contact);
        }
    }

    public function removeContact(Contact $contact): void
    {
        $this->contacts->removeElement($contact);
    }

    public function primaryContact(): ?Contact
    {
        foreach ($this->contacts as $contact) {
            if ($contact->isPrimary) {
                return $contact;
            }
        }

        return null;
    }

    public function changeLogo(?string $path): void
    {
        $this->logoPath = $path;
    }

    public function countPublishedBooks(): int
    {
        return $this->books->filter(static fn (Book $b): bool => $b->isPublished())->count();
    }

    public function isSmallPublisher(): bool
    {
        return CatalogSize::UnderHundred === $this->catalogSize;
    }

    public function sizeLabel(): string
    {
        return match ($this->catalogSize) {
            CatalogSize::UnderHundred => 'Under 100 titles',
            CatalogSize::HundredToThousand => 'From 100 to 1,000 titles',
            CatalogSize::OverThousand => 'Over 1,000 titles',
        };
    }

    public function formattedSiret(): string
    {
        return implode(' ', [
            substr($this->siret, 0, 3),
            substr($this->siret, 3, 3),
            substr($this->siret, 6, 3),
            substr($this->siret, 9, 5),
        ]);
    }

    public function displayName(): string
    {
        return $this->tradeName ?? $this->companyName;
    }

    public function seniority(\DateTimeImmutable $today = new \DateTimeImmutable()): ?int
    {
        if (null === $this->foundingYear) {
            return null;
        }

        return (int) $today->format('Y') - $this->foundingYear;
    }

    public function hasIsbnPrefix(): bool
    {
        return null !== $this->isbnPrefix && '' !== $this->isbnPrefix;
    }

    public function coversLanguage(Language $language): bool
    {
        return $this->languages->contains($language);
    }

    public function coversGenre(Genre $genre): bool
    {
        return $this->genres->contains($genre);
    }

    #[\Override]
    public function __toString(): string
    {
        return \sprintf('%s (%s)', $this->displayName(), $this->formattedSiret());
    }
}
